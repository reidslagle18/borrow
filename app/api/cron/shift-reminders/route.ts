import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { mondayOf, prettyRange, createNotification } from "@/lib/team";
import { fmtWeekday } from "@/lib/dates";
import { sendShiftReminder } from "@/lib/email";

/**
 * Night-before shift reminders (run by Vercel Cron — see vercel.json).
 * Emails + in-app-notifies each staffer scheduled tomorrow, once per shift
 * (reminder_sent flag). Only fires for shifts in a PUBLISHED week.
 * Protected by CRON_SECRET when set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  await ensureSchema();

  const rows = await sql`
    SELECT s.id, to_char(s.shift_date,'YYYY-MM-DD') AS d, s.start_time, s.end_time, s.is_training,
           s.team_member_id, tm.name, tm.email
    FROM shifts s JOIN team_members tm ON tm.id = s.team_member_id
    WHERE s.reminder_sent = false
      AND s.team_member_id IS NOT NULL
      AND s.shift_date = (now() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day'
  `;

  let sent = 0;
  for (const r of rows as { id: number; d: string; start_time: string; end_time: string; is_training: boolean; name: string; email: string | null }[]) {
    // only remind for published weeks
    const wk = await sql`SELECT status FROM schedule_weeks WHERE week_start = ${mondayOf(r.d)}`;
    if (wk[0]?.status !== "published") continue;

    await createNotification({
      memberId: (await sql`SELECT team_member_id FROM shifts WHERE id = ${r.id}`)[0]?.team_member_id,
      kind: "shift_reminder",
      title: "Shift tomorrow",
      body: `${fmtWeekday(r.d)} · ${prettyRange(r.start_time, r.end_time)}${r.is_training ? " · Training" : ""}`,
      link: "/my-shifts",
    });
    if (r.email) {
      try {
        await sendShiftReminder({
          to: r.email,
          name: r.name,
          dateLabel: fmtWeekday(r.d),
          timeLabel: prettyRange(r.start_time, r.end_time),
          training: r.is_training,
        });
        sent++;
      } catch {
        /* non-fatal */
      }
    }
    await sql`UPDATE shifts SET reminder_sent = true WHERE id = ${r.id}`;
  }

  return NextResponse.json({ ok: true, reminders_sent: sent, candidates: rows.length });
}
