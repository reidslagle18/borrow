import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { writeTimeAudit } from "@/lib/timeclock";
import { memberForStaffUser, createNotification } from "@/lib/team";
import { sendTimeApprovalAlert } from "@/lib/email";

/**
 * Staff resolves their own missed clock-out by entering the actual end time.
 * The entry moves to pending_approval (the owner confirms it). The entered
 * datetime is interpreted as America/Chicago local time. No time is discarded.
 * Body: { entry_id, end: "YYYY-MM-DDTHH:MM" }
 */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));
  const entryId = Number(b.entry_id);
  const end = String(b.end || "").slice(0, 16);
  if (!entryId || !end) return NextResponse.json({ error: "Missing entry or end time." }, { status: 400 });

  const before = (
    await sql`SELECT id, to_char(clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in, clock_out
             FROM time_entries
             WHERE id = ${entryId} AND team_member_id = ${member.id} AND archived_at IS NULL`
  )[0];
  if (!before) return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  if (before.clock_out) return NextResponse.json({ error: "That entry is already closed." }, { status: 409 });

  const rows = await sql`
    UPDATE time_entries
    SET clock_out = (${end})::timestamp AT TIME ZONE 'America/Chicago',
        status = 'pending_approval', updated_at = now()
    WHERE id = ${entryId} AND team_member_id = ${member.id}
    RETURNING to_char(clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out
  `;
  await writeTimeAudit({
    entryId,
    session,
    action: "resolve_missed",
    reason: "Staff entered actual end time for a missed clock-out",
    before: { clock_out: null },
    after: { clock_out: rows[0].clock_out },
  });

  await createNotification({
    toAdmin: true,
    kind: "time_approval",
    title: "Missed clock-out resolved — needs approval",
    body: `${member.name} entered an end time for a missed clock-out.`,
    link: "/team/timesheets",
  });
  if (process.env.ADMIN_EMAIL) {
    try {
      await sendTimeApprovalAlert({ to: process.env.ADMIN_EMAIL, memberName: member.name, summary: "Missed clock-out — staff entered the end time." });
    } catch {
      /* non-fatal */
    }
  }
  return NextResponse.json({ ok: true });
}
