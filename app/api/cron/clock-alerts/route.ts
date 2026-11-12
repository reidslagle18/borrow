import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { createNotification } from "@/lib/team";
import { prettyRange } from "@/lib/team-shared";
import { sendClockInReminder, sendNoClockInAlert } from "@/lib/email";

/**
 * Clock alerts (run every few minutes by Vercel Cron — see vercel.json):
 *  1. Remind staff to clock in at shift start.
 *  2. Alert the owner if someone hasn't clocked in 10 min after shift start.
 *  3. Flag forgotten clock-outs as "missed clock-out" (no time is discarded —
 *     staff/owner enter the real end time for approval).
 * Each fires once (guarded by flags). Only for PUBLISHED weeks.
 * Protected by CRON_SECRET when set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();

  // 1. Clock-in reminders — shift start has arrived.
  const reminders = await sql`
    SELECT s.id, tm.name, tm.email, s.start_time, s.end_time
    FROM shifts s
    JOIN team_members tm ON tm.id = s.team_member_id
    JOIN schedule_weeks w ON w.week_start = date_trunc('week', s.shift_date)::date AND w.status = 'published'
    WHERE s.shift_date = (now() AT TIME ZONE 'America/Chicago')::date
      AND s.clockin_reminded = false
      AND (now() AT TIME ZONE 'America/Chicago')::time >= s.start_time::time
      AND tm.email IS NOT NULL
  `;
  let remindersSent = 0;
  for (const r of reminders as { id: number; name: string; email: string; start_time: string; end_time: string }[]) {
    try {
      await sendClockInReminder({ to: r.email, name: r.name, shiftLabel: prettyRange(r.start_time, r.end_time) });
      remindersSent++;
    } catch {
      /* non-fatal */
    }
    await sql`UPDATE shifts SET clockin_reminded = true WHERE id = ${r.id}`;
  }

  // 2. No-clock-in alerts to the owner — 10 min past start, still no entry today.
  const noShows = await sql`
    SELECT s.id, tm.id AS mid, tm.name, s.start_time, s.end_time
    FROM shifts s
    JOIN team_members tm ON tm.id = s.team_member_id
    JOIN schedule_weeks w ON w.week_start = date_trunc('week', s.shift_date)::date AND w.status = 'published'
    WHERE s.shift_date = (now() AT TIME ZONE 'America/Chicago')::date
      AND s.noclockin_alerted = false
      AND (now() AT TIME ZONE 'America/Chicago')::time >= (s.start_time::time + interval '10 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM time_entries te
        WHERE te.team_member_id = tm.id AND te.archived_at IS NULL
          AND (te.clock_in AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
      )
  `;
  let alerts = 0;
  for (const r of noShows as { id: number; mid: number; name: string; start_time: string; end_time: string }[]) {
    const label = prettyRange(r.start_time, r.end_time);
    await createNotification({
      toAdmin: true,
      kind: "no_clockin",
      title: "Not clocked in",
      body: `${r.name} is scheduled ${label} but hasn't clocked in.`,
      link: "/team/timesheets",
    });
    if (process.env.ADMIN_EMAIL) {
      try {
        await sendNoClockInAlert({ to: process.env.ADMIN_EMAIL, memberName: r.name, shiftLabel: label });
      } catch {
        /* non-fatal */
      }
    }
    await sql`UPDATE shifts SET noclockin_alerted = true WHERE id = ${r.id}`;
    alerts++;
  }

  // 3. Missed clock-outs — open > 12h. Flag (don't auto-close / discard time).
  const missed = await sql`
    SELECT te.id, te.team_member_id AS mid, tm.name
    FROM time_entries te JOIN team_members tm ON tm.id = te.team_member_id
    WHERE te.clock_out IS NULL AND te.archived_at IS NULL AND te.missed_clockout = false
      AND te.clock_in < now() - interval '12 hours'
  `;
  let missedFlagged = 0;
  for (const r of missed as { id: number; mid: number; name: string }[]) {
    await sql`UPDATE time_entries SET missed_clockout = true, updated_at = now() WHERE id = ${r.id}`;
    await createNotification({
      memberId: r.mid,
      kind: "missed_clockout",
      title: "Missed clock-out",
      body: "You didn't clock out. Open the clock to enter your actual end time.",
      link: "/clock",
    });
    await createNotification({
      toAdmin: true,
      kind: "missed_clockout",
      title: "Missed clock-out",
      body: `${r.name} didn't clock out — needs an end time entered + approval.`,
      link: "/team/timesheets",
    });
    missedFlagged++;
  }

  return NextResponse.json({
    ok: true,
    reminders_sent: remindersSent,
    no_clockin_alerts: alerts,
    missed_clockouts_flagged: missedFlagged,
  });
}
