/**
 * Shift-coverage helpers: who is eligible to pick up a shift, and the shared
 * shift-label formatter. Eligible = active, available that weekday, not on
 * approved time off, not marked unavailable that date, not already scheduled
 * that day, and under their weekly max.
 */
import { sql } from "@/lib/db";
import { fromISO } from "@/lib/dates";
import { prettyRange } from "@/lib/team-shared";
import { fmtWeekday } from "@/lib/dates";

export interface CoverageShift {
  id: number;
  shift_date: string; // YYYY-MM-DD
  start_time: string;
  end_time: string;
}

export function shiftLabel(s: CoverageShift): string {
  return `${fmtWeekday(s.shift_date)} · ${prettyRange(s.start_time, s.end_time)}`;
}

export async function eligibleMembersForShift(
  shiftDate: string,
  excludeMemberId: number | null
): Promise<{ id: number; name: string; email: string | null }[]> {
  const weekday = fromISO(shiftDate).getDay(); // 0=Sun … 6=Sat
  const rows = await sql`
    SELECT tm.id, tm.name, tm.email
    FROM team_members tm
    WHERE tm.active = true
      AND tm.id <> ${excludeMemberId ?? -1}
      AND NOT EXISTS (
        SELECT 1 FROM availability a
        WHERE a.team_member_id = tm.id AND a.weekday = ${weekday} AND a.available = false)
      AND NOT EXISTS (
        SELECT 1 FROM unavailable_dates u
        WHERE u.team_member_id = tm.id AND u.the_date = ${shiftDate})
      AND NOT EXISTS (
        SELECT 1 FROM time_off t
        WHERE t.team_member_id = tm.id AND t.status = 'approved'
          AND ${shiftDate} BETWEEN t.start_date AND t.end_date)
      AND NOT EXISTS (
        SELECT 1 FROM shifts s2
        WHERE s2.team_member_id = tm.id AND s2.shift_date = ${shiftDate})
      AND (
        tm.max_shifts_per_week IS NULL OR
        (SELECT COUNT(*) FROM shifts s3
         WHERE s3.team_member_id = tm.id
           AND date_trunc('week', s3.shift_date) = date_trunc('week', ${shiftDate}::date))
          < tm.max_shifts_per_week)
    ORDER BY tm.name ASC
  `;
  return rows as { id: number; name: string; email: string | null }[];
}

/** Is a specific member eligible to take a shift on `shiftDate`? */
export async function isMemberEligible(memberId: number, shiftDate: string): Promise<boolean> {
  const eligible = await eligibleMembersForShift(shiftDate, null);
  return eligible.some((m) => m.id === memberId);
}
