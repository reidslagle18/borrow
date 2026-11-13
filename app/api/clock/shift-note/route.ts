import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser, createNotification } from "@/lib/team";

/** GET — the staffer's own recent shift notes. */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ notes: [] });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ notes: [] });
  const notes = await sql`
    SELECT id, to_char(shift_date,'YYYY-MM-DD') AS shift_date, body, needs_attention,
           to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
    FROM shift_notes WHERE member_id = ${member.id} AND archived_at IS NULL
    ORDER BY created_at DESC LIMIT 20
  `;
  return NextResponse.json({ notes }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — leave an end-of-shift note. Body: { shift_id?, body } */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));
  const body = String(b.body || "").trim();
  if (!body) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  const shiftId = b.shift_id ? Number(b.shift_id) : null;

  const rows = await sql`
    INSERT INTO shift_notes (shift_id, member_id, shift_date, body)
    VALUES (
      ${shiftId}, ${member.id},
      COALESCE((SELECT shift_date FROM shifts WHERE id = ${shiftId}), (now() AT TIME ZONE 'America/Chicago')::date),
      ${body}
    )
    RETURNING id
  `;
  await createNotification({
    toAdmin: true,
    kind: "shift_note",
    title: "New shift note",
    body: `${member.name}: ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`,
    link: "/team/notes",
  });
  return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
}
