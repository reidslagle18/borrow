import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { mondayOf } from "@/lib/team";
import { todayISO, addDays } from "@/lib/dates";

/**
 * GET /api/my-shifts — the logged-in staffer's upcoming shifts + the coverage
 * picture (who's working each day). Only PUBLISHED weeks are ever returned.
 */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.userId == null)
    return NextResponse.json({ member: null, upcoming: [], coverage: [] });

  const member = (
    await sql`SELECT id, name, ical_token FROM team_members WHERE staff_user_id = ${session.userId} AND active = true LIMIT 1`
  )[0];
  if (!member) return NextResponse.json({ member: null, upcoming: [], coverage: [] });

  const today = todayISO();
  const horizon = addDays(today, 70);

  const [shifts, pubWeeks] = await Promise.all([
    sql`SELECT s.id, to_char(s.shift_date,'YYYY-MM-DD') AS date, s.start_time, s.end_time,
               s.team_member_id, s.is_training, tm.name AS member_name
        FROM shifts s LEFT JOIN team_members tm ON tm.id = s.team_member_id
        WHERE s.shift_date >= ${today} AND s.shift_date <= ${horizon}
        ORDER BY s.shift_date ASC`,
    sql`SELECT to_char(week_start,'YYYY-MM-DD') AS week_start FROM schedule_weeks
        WHERE status = 'published' AND week_start >= ${addDays(today, -7)} AND week_start <= ${horizon}`,
  ]);

  const published = new Set((pubWeeks as { week_start: string }[]).map((w) => w.week_start));
  const visible = (shifts as { id: number; date: string; start_time: string; end_time: string; team_member_id: number | null; is_training: boolean; member_name: string | null }[])
    .filter((s) => published.has(mondayOf(s.date)));

  const upcoming = visible
    .filter((s) => s.team_member_id === member.id)
    .map((s) => ({ id: s.id, date: s.date, start_time: s.start_time, end_time: s.end_time, is_training: s.is_training }));

  const coverage = visible
    .filter((s) => s.team_member_id != null)
    .map((s) => ({ date: s.date, member_name: s.member_name, is_training: s.is_training, mine: s.team_member_id === member.id }));

  return NextResponse.json(
    { member: { id: member.id, name: member.name, ical_token: member.ical_token }, upcoming, coverage },
    { headers: { "Cache-Control": "no-store" } }
  );
}
