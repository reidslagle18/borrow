import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser, createNotification, getTeamSettings } from "@/lib/team";
import { eligibleMembersForShift, isMemberEligible, shiftLabel } from "@/lib/coverage";
import { sendCoverageRequest } from "@/lib/email";

/** GET — the Open Shifts board for the signed-in staffer + their own requests. */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ member: null, board: [], mine: [] });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ member: null, board: [], mine: [] });

  const open = await sql`
    SELECT cr.id, cr.kind, cr.status, cr.target_member_id, cr.note,
           cr.requester_member_id, rm.name AS requester_name,
           to_char(s.shift_date,'YYYY-MM-DD') AS shift_date, s.start_time, s.end_time, s.is_training
    FROM coverage_requests cr
    JOIN shifts s ON s.id = cr.shift_id
    LEFT JOIN team_members rm ON rm.id = cr.requester_member_id
    WHERE cr.status = 'open'
      AND (cr.target_member_id IS NULL OR cr.target_member_id = ${member.id})
      AND (cr.requester_member_id IS NULL OR cr.requester_member_id <> ${member.id})
      AND s.shift_date >= (now() AT TIME ZONE 'America/Chicago')::date
    ORDER BY s.shift_date ASC
  `;
  // keep only shifts this member is actually eligible to take
  const board = [];
  for (const r of open as { shift_date: string }[]) {
    if (await isMemberEligible(member.id, r.shift_date)) board.push(r);
  }

  const mine = await sql`
    SELECT cr.id, cr.kind, cr.status, cr.target_member_id, tm.name AS target_name,
           cr.claimed_by_member_id, cm.name AS claimed_by_name,
           to_char(s.shift_date,'YYYY-MM-DD') AS shift_date, s.start_time, s.end_time
    FROM coverage_requests cr
    JOIN shifts s ON s.id = cr.shift_id
    LEFT JOIN team_members tm ON tm.id = cr.target_member_id
    LEFT JOIN team_members cm ON cm.id = cr.claimed_by_member_id
    WHERE cr.requester_member_id = ${member.id} AND cr.status <> 'cancelled'
    ORDER BY s.shift_date ASC
  `;
  return NextResponse.json({ member: { id: member.id, name: member.name }, board, mine }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST — request coverage for one of your shifts.
 * Body: { shift_id, kind: "coverage" | "sick", target_member_id? }
 * coverage: notify eligible teammates (or just the targeted one).
 * sick: emergency — notify all eligible teammates AND the owner immediately.
 * You stay responsible until a replacement is approved.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));
  const shiftId = Number(b.shift_id);
  const kind = b.kind === "sick" ? "sick" : "coverage";
  const target = b.target_member_id ? Number(b.target_member_id) : null;

  const shift = (
    await sql`SELECT id, to_char(shift_date,'YYYY-MM-DD') AS shift_date, start_time, end_time, team_member_id
             FROM shifts WHERE id = ${shiftId}`
  )[0];
  if (!shift) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
  if (shift.team_member_id !== member.id) return NextResponse.json({ error: "That's not your shift." }, { status: 403 });
  if (shift.shift_date < new Date().toISOString().slice(0, 10))
    return NextResponse.json({ error: "That shift has already passed." }, { status: 400 });

  const existing = await sql`SELECT id FROM coverage_requests WHERE shift_id = ${shiftId} AND status IN ('open','claimed')`;
  if (existing.length) return NextResponse.json({ error: "There's already an active coverage request for this shift." }, { status: 409 });

  const eligible = await eligibleMembersForShift(shift.shift_date, member.id);
  if (target && !eligible.some((m) => m.id === target))
    return NextResponse.json({ error: "That teammate isn't available for this shift." }, { status: 400 });

  const rows = await sql`
    INSERT INTO coverage_requests (shift_id, requester_member_id, kind, target_member_id, note)
    VALUES (${shiftId}, ${member.id}, ${kind}, ${target}, ${b.note || null})
    RETURNING id
  `;

  const label = shiftLabel(shift);
  const recipients = target ? eligible.filter((m) => m.id === target) : eligible;
  const settings = await getTeamSettings();
  for (const r of recipients) {
    await createNotification({
      memberId: r.id,
      kind: "coverage_open",
      title: kind === "sick" ? "Urgent: shift needs coverage" : "A shift needs coverage",
      body: `${member.name} — ${label}. Tap to take it.`,
      link: "/open-shifts",
    });
    if (r.email) {
      try {
        await sendCoverageRequest({ to: r.email, name: r.name, shiftLabel: label, urgent: kind === "sick", byName: member.name });
      } catch {
        /* non-fatal */
      }
    }
  }
  // Sick/emergency also alerts the owner right away.
  if (kind === "sick") {
    await createNotification({
      toAdmin: true,
      kind: "coverage_sick",
      title: "Sick call — coverage needed",
      body: `${member.name} is out sick for ${label}. ${recipients.length} teammate(s) notified.`,
      link: "/team/coverage",
    });
  }
  void settings;
  return NextResponse.json({ ok: true, id: rows[0].id, notified: recipients.length }, { status: 201 });
}
