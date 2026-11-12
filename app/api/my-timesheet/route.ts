import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { getPayConfig, periodForDate, shiftPeriod, periodLabel, workedMinutes, writeTimeAudit } from "@/lib/timeclock";
import { memberForStaffUser, createNotification } from "@/lib/team";

/** GET — the signed-in staffer's own entries + totals for a pay period. */
export async function GET(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ member: null, entries: [] });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ member: null, entries: [] });

  const url = new URL(request.url);
  const cfg = await getPayConfig();
  const period = periodForDate(url.searchParams.get("period") || todayISO(), cfg);

  const rows = await sql`
    SELECT te.id,
           to_char(te.clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
           to_char(te.clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out,
           (te.clock_in AT TIME ZONE 'America/Chicago')::date::text AS day,
           te.source, te.status, te.missed_clockout, te.early_arrival, te.late_clockout,
           te.employee_flagged, te.employee_flag_note, te.note,
           to_char(te.approved_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS approved_at
    FROM time_entries te
    WHERE te.team_member_id = ${member.id} AND te.archived_at IS NULL
      AND (te.clock_in AT TIME ZONE 'America/Chicago')::date BETWEEN ${period.start} AND ${period.end}
    ORDER BY te.clock_in ASC
  `;
  const entries = (rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    minutes: workedMinutes(r.clock_in as string, r.clock_out as string | null),
  }));

  // audit visible to the employee
  const ids = (rows as { id: number }[]).map((r) => r.id);
  const audit: Record<number, unknown[]> = {};
  if (ids.length) {
    const arows = await sql`
      SELECT time_entry_id, actor_name, action, reason,
             to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
      FROM time_entry_audit WHERE time_entry_id = ANY(${ids}) ORDER BY created_at ASC
    `;
    for (const a of arows as { time_entry_id: number }[]) (audit[a.time_entry_id] ||= []).push(a);
  }

  const totalMinutes = entries.reduce((s, e) => s + (e.minutes as number), 0);
  return NextResponse.json(
    {
      member: { id: member.id, name: member.name },
      period: { start: period.start, end: period.end, label: periodLabel(period) },
      prev: shiftPeriod(period.start, cfg, -1).start,
      next: shiftPeriod(period.start, cfg, 1).start,
      entries,
      audit,
      total_minutes: totalMinutes,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** POST — flag one of your own entries as incorrect, with a note. */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));
  const entryId = Number(b.entry_id);
  const note = String(b.note || "").trim();
  if (!entryId || !note) return NextResponse.json({ error: "Add a note about what's wrong." }, { status: 400 });

  const owned = await sql`SELECT id FROM time_entries WHERE id = ${entryId} AND team_member_id = ${member.id} AND archived_at IS NULL`;
  if (!owned[0]) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  await sql`UPDATE time_entries SET employee_flagged = true, employee_flag_note = ${note}, updated_at = now() WHERE id = ${entryId}`;
  await writeTimeAudit({ entryId, session, action: "employee_flag", reason: note, after: { employee_flagged: true } });
  await createNotification({
    toAdmin: true,
    kind: "time_flag",
    title: "Timesheet flagged by staff",
    body: `${member.name} flagged an entry: ${note}`,
    link: "/team/timesheets",
  });
  return NextResponse.json({ ok: true });
}
