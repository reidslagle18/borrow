import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { writeTimeAudit } from "@/lib/timeclock";
import { memberForStaffUser, createNotification } from "@/lib/team";
import { sendTimeApprovalAlert } from "@/lib/email";

/**
 * Staff manual time request (used when the iPad fails). Submits start + end +
 * reason; lands as a manual entry in pending_approval for the owner to approve.
 * Naive datetimes are interpreted as America/Chicago local time.
 * Body: { start: "YYYY-MM-DDTHH:MM", end: "YYYY-MM-DDTHH:MM", reason }
 */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));
  const start = String(b.start || "").slice(0, 16);
  const end = String(b.end || "").slice(0, 16);
  const reason = String(b.reason || "").trim();
  if (!start || !end) return NextResponse.json({ error: "Enter both a start and end time." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "Please add a reason." }, { status: 400 });
  if (end <= start) return NextResponse.json({ error: "End must be after start." }, { status: 400 });

  const rows = await sql`
    INSERT INTO time_entries (team_member_id, clock_in, clock_out, source, status, note)
    VALUES (
      ${member.id},
      (${start})::timestamp AT TIME ZONE 'America/Chicago',
      (${end})::timestamp AT TIME ZONE 'America/Chicago',
      'manual', 'pending_approval', ${reason}
    )
    RETURNING id, to_char(clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
              to_char(clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out
  `;
  await writeTimeAudit({
    entryId: rows[0].id,
    session,
    action: "manual_request",
    reason,
    after: { clock_in: rows[0].clock_in, clock_out: rows[0].clock_out, source: "manual" },
  });

  const summary = `Manual entry: ${start.replace("T", " ")} → ${end.replace("T", " ")} (${reason})`;
  await createNotification({
    toAdmin: true,
    kind: "time_approval",
    title: "Time entry needs approval",
    body: `${member.name} — ${summary}`,
    link: "/team/timesheets",
  });
  if (process.env.ADMIN_EMAIL) {
    try {
      await sendTimeApprovalAlert({ to: process.env.ADMIN_EMAIL, memberName: member.name, summary });
    } catch {
      /* non-fatal */
    }
  }
  return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
}
