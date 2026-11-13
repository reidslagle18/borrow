import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { DEFAULT_START, DEFAULT_END, createNotification } from "@/lib/team";
import { eligibleMembersForShift, shiftLabel } from "@/lib/coverage";
import { sendCoverageRequest } from "@/lib/email";

/** GET — all coverage requests (admin), pending claims first. */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const rows = await sql`
    SELECT cr.id, cr.kind, cr.status, cr.note,
           rm.name AS requester_name, tm.name AS target_name, cm.name AS claimed_by_name,
           to_char(s.shift_date,'YYYY-MM-DD') AS shift_date, s.start_time, s.end_time, s.is_training,
           to_char(cr.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
    FROM coverage_requests cr
    JOIN shifts s ON s.id = cr.shift_id
    LEFT JOIN team_members rm ON rm.id = cr.requester_member_id
    LEFT JOIN team_members tm ON tm.id = cr.target_member_id
    LEFT JOIN team_members cm ON cm.id = cr.claimed_by_member_id
    ORDER BY (cr.status = 'claimed') DESC, (cr.status = 'open') DESC, s.shift_date ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST — owner posts an extra / unfilled shift to the Open Shifts board.
 * Body: { date: "YYYY-MM-DD", start_time?, end_time?, note? }
 * Creates an unassigned shift for that day if none exists, then opens it.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const date = String(b.date || "").slice(0, 10);
  if (!date) return NextResponse.json({ error: "Pick a date." }, { status: 400 });

  let shift = (await sql`SELECT id, team_member_id, to_char(shift_date,'YYYY-MM-DD') AS shift_date, start_time, end_time FROM shifts WHERE shift_date = ${date}`)[0];
  if (shift && shift.team_member_id) {
    return NextResponse.json({ error: "That day already has someone assigned — use the schedule to change it." }, { status: 409 });
  }
  if (!shift) {
    shift = (
      await sql`INSERT INTO shifts (shift_date, start_time, end_time) VALUES (${date}, ${b.start_time || DEFAULT_START}, ${b.end_time || DEFAULT_END})
                RETURNING id, team_member_id, to_char(shift_date,'YYYY-MM-DD') AS shift_date, start_time, end_time`
    )[0];
    await sql`INSERT INTO schedule_weeks (week_start) VALUES (date_trunc('week', ${date}::date)::date) ON CONFLICT (week_start) DO NOTHING`;
  }

  const existing = await sql`SELECT id FROM coverage_requests WHERE shift_id = ${shift.id} AND status IN ('open','claimed')`;
  if (existing.length) return NextResponse.json({ error: "That shift is already on the board." }, { status: 409 });

  await sql`INSERT INTO coverage_requests (shift_id, kind, note) VALUES (${shift.id}, 'extra', ${b.note || null})`;
  const eligible = await eligibleMembersForShift(shift.shift_date, null);
  const label = shiftLabel(shift);
  for (const r of eligible) {
    await createNotification({ memberId: r.id, kind: "coverage_open", title: "Extra shift available", body: `${label} — tap to claim.`, link: "/open-shifts" });
    if (r.email) { try { await sendCoverageRequest({ to: r.email, name: r.name, shiftLabel: label }); } catch {} }
  }
  await logAudit("coverage_extra_post", { entity: "shift", entityId: shift.id }, admin);
  return NextResponse.json({ ok: true, notified: eligible.length }, { status: 201 });
}
