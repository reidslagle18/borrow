import { sql, ensureSchema } from "@/lib/db";
import { buildICal, mondayOf } from "@/lib/team";
import { todayISO, addDays } from "@/lib/dates";

/**
 * Public, tokenized iCal feed for a staffer's shifts — the URL a phone's
 * calendar app subscribes to. Auth is the secret `token` (the member's
 * ical_token); no session needed, mirroring the drop-off manage_token pattern.
 * Only PUBLISHED weeks are included.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) return new Response("Missing token", { status: 400 });

  const member = (await sql`SELECT id, name FROM team_members WHERE ical_token = ${token} LIMIT 1`)[0];
  if (!member) return new Response("Not found", { status: 404 });

  const from = addDays(todayISO(), -21);
  const to = addDays(todayISO(), 84);
  const [shifts, pubWeeks] = await Promise.all([
    sql`SELECT id, to_char(shift_date,'YYYY-MM-DD') AS shift_date, start_time, end_time, is_training
        FROM shifts WHERE team_member_id = ${member.id} AND shift_date >= ${from} AND shift_date <= ${to}
        ORDER BY shift_date ASC`,
    sql`SELECT to_char(week_start,'YYYY-MM-DD') AS week_start FROM schedule_weeks WHERE status = 'published'`,
  ]);
  const published = new Set((pubWeeks as { week_start: string }[]).map((w) => w.week_start));
  const visible = (shifts as { id: number; shift_date: string; start_time: string; end_time: string; is_training: boolean }[])
    .filter((s) => published.has(mondayOf(s.shift_date)));

  const ics = buildICal(member.name, visible, new Date());
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="borrow-shifts.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
