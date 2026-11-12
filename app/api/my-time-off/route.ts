import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser, createNotification } from "@/lib/team";
import { fmtShort } from "@/lib/dates";
import { sendTimeOffRequestAlert } from "@/lib/email";

/** The logged-in staffer's own time-off requests. */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ member: null, requests: [] });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ member: null, requests: [] });

  const requests = await sql`
    SELECT id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date,
           note, status, decided_note
    FROM time_off WHERE team_member_id = ${member.id}
    ORDER BY start_date DESC
  `;
  return NextResponse.json({ member: { id: member.id, name: member.name }, requests }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — submit a time-off request. Body: { start_date, end_date, note? } */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));
  const start = String(b.start_date || "").slice(0, 10);
  const end = String(b.end_date || start).slice(0, 10);
  if (!start) return NextResponse.json({ error: "Pick at least a start date." }, { status: 400 });
  if (end < start) return NextResponse.json({ error: "End date can't be before the start date." }, { status: 400 });

  const rows = await sql`
    INSERT INTO time_off (team_member_id, start_date, end_date, note)
    VALUES (${member.id}, ${start}, ${end}, ${b.note || null})
    RETURNING id
  `;

  const range = start === end ? fmtShort(start) : `${fmtShort(start)} – ${fmtShort(end)}`;
  await createNotification({
    toAdmin: true,
    kind: "timeoff_request",
    title: "New time-off request",
    body: `${member.name} requested ${range}${b.note ? ` — ${b.note}` : ""}`,
    link: "/team/time-off",
  });
  if (process.env.ADMIN_EMAIL) {
    try {
      await sendTimeOffRequestAlert({ to: process.env.ADMIN_EMAIL, memberName: member.name, rangeLabel: range, note: b.note || undefined });
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
}
