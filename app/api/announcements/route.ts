import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser } from "@/lib/team";

/** GET — active announcements for the signed-in staffer, with read status. */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ member: null, announcements: [] });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ member: null, announcements: [] });
  const rows = await sql`
    SELECT a.id, a.title, a.body, a.created_by,
           to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
           (r.member_id IS NOT NULL) AS read
    FROM announcements a
    LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.member_id = ${member.id}
    WHERE a.archived_at IS NULL
    ORDER BY a.created_at DESC
  `;
  return NextResponse.json({ member: { id: member.id, name: member.name }, announcements: rows }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — mark an announcement read. Body: { id } */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });
  const b = await request.json().catch(() => ({}));
  const aid = Number(b.id);
  if (!aid) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  await sql`INSERT INTO announcement_reads (announcement_id, member_id) VALUES (${aid}, ${member.id})
            ON CONFLICT (announcement_id, member_id) DO NOTHING`;
  return NextResponse.json({ ok: true });
}
