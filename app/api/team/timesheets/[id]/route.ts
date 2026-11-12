import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getPayConfig, periodForDate, isPeriodClosed, writeTimeAudit } from "@/lib/timeclock";
import { createNotification } from "@/lib/team";
import { sendTimeEntryDecision } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH a time entry (admin). Actions: approve | edit | archive | reopen |
 * clear_flag. Every change is audited (who/when/reason + before/after) and the
 * employee is notified. Entries are archived, never hard-deleted. Changes to a
 * CLOSED pay period require a reason.
 * Body: { action, reason?, clock_in?, clock_out? }  (times = "YYYY-MM-DDTHH:MM", Central)
 */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  const eid = Number(id);
  const b = await request.json().catch(() => ({}));
  const action = b.action as string;
  const reason = (b.reason ? String(b.reason) : "").trim();

  const cur = (
    await sql`SELECT te.*, tm.name AS member_name, tm.email AS member_email,
                     (te.clock_in AT TIME ZONE 'America/Chicago')::date::text AS day,
                     to_char(te.clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in_iso,
                     to_char(te.clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out_iso
              FROM time_entries te JOIN team_members tm ON tm.id = te.team_member_id
              WHERE te.id = ${eid}`
  )[0];
  if (!cur) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cfg = await getPayConfig();
  const period = periodForDate(cur.day, cfg);
  const closed = await isPeriodClosed(period.start);
  if (closed && action !== "clear_flag" && !reason) {
    return NextResponse.json(
      { error: "This pay period is closed — a reason is required to change it." },
      { status: 400 }
    );
  }

  let employeeSummary = "";

  if (action === "approve") {
    await sql`UPDATE time_entries SET status = 'approved', approved_by = ${admin.name},
              approved_at = now(), updated_at = now() WHERE id = ${eid}`;
    await writeTimeAudit({ entryId: eid, session: admin, action: "approve", reason: reason || null });
    employeeSummary = "An entry was approved.";
  } else if (action === "edit") {
    if (!reason) return NextResponse.json({ error: "A reason is required to edit a time entry." }, { status: 400 });
    const before = { clock_in: cur.clock_in_iso, clock_out: cur.clock_out_iso };
    if (b.clock_in) {
      await sql`UPDATE time_entries SET clock_in = (${String(b.clock_in).slice(0, 16)})::timestamp AT TIME ZONE 'America/Chicago', updated_at = now() WHERE id = ${eid}`;
    }
    if (b.clock_out) {
      await sql`UPDATE time_entries SET clock_out = (${String(b.clock_out).slice(0, 16)})::timestamp AT TIME ZONE 'America/Chicago', status = CASE WHEN status = 'open' THEN 'completed' ELSE status END, missed_clockout = false, updated_at = now() WHERE id = ${eid}`;
    }
    const after = (
      await sql`SELECT to_char(clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
                       to_char(clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out
                FROM time_entries WHERE id = ${eid}`
    )[0];
    await writeTimeAudit({ entryId: eid, session: admin, action: "edit", reason, before, after });
    employeeSummary = `Your hours were edited. Reason: ${reason}`;
  } else if (action === "archive") {
    if (!reason) return NextResponse.json({ error: "A reason is required to archive a time entry." }, { status: 400 });
    await sql`UPDATE time_entries SET archived_at = now(), updated_at = now() WHERE id = ${eid} AND archived_at IS NULL`;
    await writeTimeAudit({ entryId: eid, session: admin, action: "archive", reason });
    employeeSummary = `An entry was archived. Reason: ${reason}`;
  } else if (action === "reopen") {
    if (!reason) return NextResponse.json({ error: "A reason is required to restore a time entry." }, { status: 400 });
    await sql`UPDATE time_entries SET archived_at = NULL, updated_at = now() WHERE id = ${eid}`;
    await writeTimeAudit({ entryId: eid, session: admin, action: "reopen", reason });
    employeeSummary = `An archived entry was restored. Reason: ${reason}`;
  } else if (action === "clear_flag") {
    await sql`UPDATE time_entries SET employee_flagged = false, updated_at = now() WHERE id = ${eid}`;
    await writeTimeAudit({ entryId: eid, session: admin, action: "clear_flag", reason: reason || null });
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  // Notify the employee (changes are visible to them).
  if (employeeSummary) {
    await createNotification({
      memberId: cur.team_member_id,
      kind: "time_decision",
      title: "Timesheet update",
      body: employeeSummary,
      link: "/my-shifts",
    });
    if (cur.member_email) {
      try {
        await sendTimeEntryDecision({ to: cur.member_email, name: cur.member_name, summary: employeeSummary });
      } catch {
        /* non-fatal */
      }
    }
  }
  await logAudit(`timesheet_${action}`, { entity: "time_entry", entityId: eid, detail: { closed } }, admin);
  return NextResponse.json({ ok: true });
}
