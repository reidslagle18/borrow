import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/team";
import { shiftLabel } from "@/lib/coverage";
import { sendCoverageResult } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH — owner approves or denies a claimed coverage request.
 * approve: reassign the shift to the claimer + notify everyone.
 * deny: reopen the request (clear the claim) + notify the claimer.
 * Body: { action: "approve" | "deny" }
 */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  const cid = Number(id);
  const b = await request.json().catch(() => ({}));
  const action = b.action === "deny" ? "deny" : b.action === "approve" ? "approve" : null;
  if (!action) return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const cr = (
    await sql`SELECT cr.id, cr.shift_id, cr.status, cr.claimed_by_member_id,
                     cm.name AS claimer_name, cm.email AS claimer_email,
                     cr.requester_member_id, rm.name AS requester_name, rm.email AS requester_email,
                     to_char(s.shift_date,'YYYY-MM-DD') AS shift_date, s.start_time, s.end_time
             FROM coverage_requests cr JOIN shifts s ON s.id = cr.shift_id
             LEFT JOIN team_members cm ON cm.id = cr.claimed_by_member_id
             LEFT JOIN team_members rm ON rm.id = cr.requester_member_id
             WHERE cr.id = ${cid}`
  )[0];
  if (!cr) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (cr.status !== "claimed") return NextResponse.json({ error: "This request isn't awaiting approval." }, { status: 409 });

  const label = shiftLabel(cr);

  if (action === "approve") {
    await sql`UPDATE shifts SET team_member_id = ${cr.claimed_by_member_id}, reminder_sent = false, noclockin_alerted = false, updated_at = now() WHERE id = ${cr.shift_id}`;
    await sql`UPDATE coverage_requests SET status = 'approved', approved_by = ${admin.name}, approved_at = now(), updated_at = now() WHERE id = ${cid}`;
    // notify claimer + requester
    if (cr.claimed_by_member_id) {
      await createNotification({ memberId: cr.claimed_by_member_id, kind: "coverage_result", title: "Shift confirmed", body: `You're covering ${label}.`, link: "/my-shifts" });
      if (cr.claimer_email) { try { await sendCoverageResult({ to: cr.claimer_email, name: cr.claimer_name, summary: `You're confirmed to cover: ${label}.` }); } catch {} }
    }
    if (cr.requester_member_id) {
      await createNotification({ memberId: cr.requester_member_id, kind: "coverage_result", title: "Coverage confirmed", body: `${cr.claimer_name} is covering your ${label}.`, link: "/my-shifts" });
      if (cr.requester_email) { try { await sendCoverageResult({ to: cr.requester_email, name: cr.requester_name, summary: `${cr.claimer_name} is covering your shift: ${label}.` }); } catch {} }
    }
    await logAudit("coverage_approve", { entity: "coverage", entityId: cid }, admin);
    return NextResponse.json({ ok: true, status: "approved" });
  }

  // deny → reopen
  await sql`UPDATE coverage_requests SET status = 'open', claimed_by_member_id = NULL, claimed_at = NULL, updated_at = now() WHERE id = ${cid}`;
  if (cr.claimed_by_member_id) {
    await createNotification({ memberId: cr.claimed_by_member_id, kind: "coverage_result", title: "Claim not approved", body: `Your claim for ${label} wasn't approved — it's open again.`, link: "/open-shifts" });
    if (cr.claimer_email) { try { await sendCoverageResult({ to: cr.claimer_email, name: cr.claimer_name, summary: `Your claim for ${label} wasn't approved. The shift is open again.` }); } catch {} }
  }
  await logAudit("coverage_deny", { entity: "coverage", entityId: cid }, admin);
  return NextResponse.json({ ok: true, status: "open" });
}
