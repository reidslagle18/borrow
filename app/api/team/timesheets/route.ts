import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { getPayConfig, periodForDate, shiftPeriod, periodLabel, isPeriodClosed, workedMinutes } from "@/lib/timeclock";

/**
 * GET /api/team/timesheets?period=YYYY-MM-DD&member=ID  (admin)
 * Entries for the pay period containing `period` (default: today), optionally by
 * member, with worked minutes, flags, status, and the full audit trail per entry.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const url = new URL(request.url);
  const cfg = await getPayConfig();
  const period = periodForDate(url.searchParams.get("period") || todayISO(), cfg);
  const memberFilter = url.searchParams.get("member");
  const closed = await isPeriodClosed(period.start);

  const rows = await sql`
    SELECT te.id, te.team_member_id, tm.name AS member_name,
           to_char(te.clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
           to_char(te.clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out,
           (te.clock_in AT TIME ZONE 'America/Chicago')::date::text AS day,
           te.source, te.status, te.missed_clockout, te.early_arrival, te.late_clockout,
           te.employee_flagged, te.employee_flag_note, te.note,
           te.approved_by, to_char(te.approved_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS approved_at
    FROM time_entries te JOIN team_members tm ON tm.id = te.team_member_id
    WHERE te.archived_at IS NULL
      AND (te.clock_in AT TIME ZONE 'America/Chicago')::date BETWEEN ${period.start} AND ${period.end}
      ${memberFilter ? sql`AND te.team_member_id = ${Number(memberFilter)}` : sql``}
    ORDER BY te.clock_in ASC
  `;

  const entries = (rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    minutes: workedMinutes(r.clock_in as string, r.clock_out as string | null),
  }));

  // audit trail per entry
  const ids = (rows as { id: number }[]).map((r) => r.id);
  let audit: Record<number, unknown[]> = {};
  if (ids.length) {
    const arows = await sql`
      SELECT time_entry_id, actor_name, actor_role, action, reason, before, after,
             to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
      FROM time_entry_audit WHERE time_entry_id = ANY(${ids}) ORDER BY created_at ASC
    `;
    audit = {};
    for (const a of arows as { time_entry_id: number }[]) {
      (audit[a.time_entry_id] ||= []).push(a);
    }
  }

  const members = await sql`SELECT id, name FROM team_members WHERE active = true ORDER BY name`;

  return NextResponse.json(
    {
      period: { start: period.start, end: period.end, label: periodLabel(period), closed },
      prev: shiftPeriod(period.start, cfg, -1).start,
      next: shiftPeriod(period.start, cfg, 1).start,
      members,
      entries,
      audit,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
