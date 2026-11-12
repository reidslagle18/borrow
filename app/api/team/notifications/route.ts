import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * GET — the team notifications for the caller. Admins see to_admin rows (e.g.
 * new time-off requests); staff see rows addressed to their team_member.
 * Returns recent items + an unread count for the bell badge.
 */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ count: 0, items: [] });

  let items: unknown[] = [];
  if (session.trueRole === "admin" && !session.viewAs) {
    items = await sql`
      SELECT id, kind, title, body, link, read_at,
             to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
      FROM team_notifications WHERE to_admin = true
      ORDER BY created_at DESC LIMIT 30
    `;
  } else if (session.userId != null) {
    const member = (await sql`SELECT id FROM team_members WHERE staff_user_id = ${session.userId} LIMIT 1`)[0];
    if (member) {
      items = await sql`
        SELECT id, kind, title, body, link, read_at,
               to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
        FROM team_notifications WHERE team_member_id = ${member.id}
        ORDER BY created_at DESC LIMIT 30
      `;
    }
  }
  const count = (items as { read_at: string | null }[]).filter((i) => !i.read_at).length;
  return NextResponse.json({ count, items }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — mark notifications read. Body: { id?: number, all?: boolean } */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await request.json().catch(() => ({}));

  const isAdmin = session.trueRole === "admin" && !session.viewAs;
  const member = session.userId != null
    ? (await sql`SELECT id FROM team_members WHERE staff_user_id = ${session.userId} LIMIT 1`)[0]
    : null;

  if (b.all) {
    if (isAdmin) await sql`UPDATE team_notifications SET read_at = now() WHERE to_admin = true AND read_at IS NULL`;
    else if (member) await sql`UPDATE team_notifications SET read_at = now() WHERE team_member_id = ${member.id} AND read_at IS NULL`;
  } else if (b.id) {
    if (isAdmin) await sql`UPDATE team_notifications SET read_at = now() WHERE id = ${Number(b.id)} AND to_admin = true`;
    else if (member) await sql`UPDATE team_notifications SET read_at = now() WHERE id = ${Number(b.id)} AND team_member_id = ${member.id}`;
  }
  return NextResponse.json({ ok: true });
}
