import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser, createNotification, getTeamSettings } from "@/lib/team";
import { isMemberEligible, shiftLabel } from "@/lib/coverage";
import { sendCoverageResult, sendCoverageClaimAlert } from "@/lib/email";
import { sendSMS } from "@/lib/sms";

type Ctx = { params: Promise<{ id: string }> };

/** Staff taps "I'll take it". First claim wins. Auto-approves if the owner has
 *  that setting on; otherwise it's pending the owner's approval. */
export async function POST(request: Request, { params }: Ctx) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const { id } = await params;
  const cid = Number(id);

  const cr = (
    await sql`SELECT cr.id, cr.shift_id, cr.status, cr.target_member_id, cr.requester_member_id,
                     rm.name AS requester_name, rm.email AS requester_email,
                     to_char(s.shift_date,'YYYY-MM-DD') AS shift_date, s.start_time, s.end_time
             FROM coverage_requests cr JOIN shifts s ON s.id = cr.shift_id
             LEFT JOIN team_members rm ON rm.id = cr.requester_member_id
             WHERE cr.id = ${cid}`
  )[0];
  if (!cr) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (cr.status !== "open") return NextResponse.json({ error: "This shift was already taken." }, { status: 409 });
  if (cr.target_member_id && cr.target_member_id !== member.id)
    return NextResponse.json({ error: "This request was sent to someone else." }, { status: 403 });
  if (cr.requester_member_id === member.id) return NextResponse.json({ error: "You can't take your own shift." }, { status: 400 });
  if (!(await isMemberEligible(member.id, cr.shift_date)))
    return NextResponse.json({ error: "You're not available for this shift." }, { status: 400 });

  // Atomic claim — first one wins.
  const claimed = await sql`
    UPDATE coverage_requests SET status = 'claimed', claimed_by_member_id = ${member.id}, claimed_at = now(), updated_at = now()
    WHERE id = ${cid} AND status = 'open' RETURNING id
  `;
  if (!claimed.length) return NextResponse.json({ error: "This shift was just taken by someone else." }, { status: 409 });

  const label = shiftLabel(cr);
  const settings = await getTeamSettings();

  if (settings.coverage_auto_approve) {
    // Reassign the shift immediately and close the request.
    await sql`UPDATE shifts SET team_member_id = ${member.id}, reminder_sent = false, noclockin_alerted = false, updated_at = now() WHERE id = ${cr.shift_id}`;
    await sql`UPDATE coverage_requests SET status = 'approved', approved_by = 'Auto-approved', approved_at = now(), updated_at = now() WHERE id = ${cid}`;
    if (cr.requester_member_id) {
      await createNotification({ memberId: cr.requester_member_id, kind: "coverage_result", title: "Coverage confirmed", body: `${member.name} is covering your ${label}.`, link: "/my-shifts" });
      if (cr.requester_email) { try { await sendCoverageResult({ to: cr.requester_email, name: cr.requester_name, summary: `${member.name} is covering your shift: ${label}.` }); } catch {} }
    }
    await createNotification({ memberId: member.id, kind: "coverage_result", title: "Shift confirmed", body: `You're covering ${label}.`, link: "/my-shifts" });
    await createNotification({ toAdmin: true, kind: "coverage_result", title: "Shift covered (auto-approved)", body: `${member.name} is covering ${cr.requester_name ?? "an open"} shift — ${label}.`, link: "/team/coverage" });
    return NextResponse.json({ ok: true, approved: true });
  }

  // Pending owner approval.
  await createNotification({ toAdmin: true, kind: "coverage_claim", title: "Shift claim needs approval", body: `${member.name} wants to take ${cr.requester_name ? cr.requester_name + "'s" : "an open"} shift — ${label}.`, link: "/team/coverage" });
  if (process.env.ADMIN_EMAIL) { try { await sendCoverageClaimAlert({ to: process.env.ADMIN_EMAIL, summary: `${member.name} claimed ${cr.requester_name ? cr.requester_name + "'s" : "an open"} shift (${label}). Approve it in Coverage.` }); } catch {} }
  await sendSMS(settings.owner_sms, `BORROW: ${member.name} wants to take ${cr.requester_name ? cr.requester_name + "'s" : "an open"} shift (${label}). Approve in Coverage.`);
  return NextResponse.json({ ok: true, approved: false });
}
