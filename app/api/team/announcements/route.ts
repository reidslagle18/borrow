import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/team";

/** GET — announcements with read receipts (admin). */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const rows = await sql`
    SELECT a.id, a.title, a.body, a.created_by,
           to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
           (SELECT COUNT(*)::int FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count,
           COALESCE((SELECT json_agg(tm.name ORDER BY tm.name)
                     FROM announcement_reads r JOIN team_members tm ON tm.id = r.member_id
                     WHERE r.announcement_id = a.id), '[]'::json) AS readers
    FROM announcements a WHERE a.archived_at IS NULL ORDER BY a.created_at DESC
  `;
  const total = (await sql`SELECT COUNT(*)::int AS n FROM team_members WHERE active = true`)[0].n;
  return NextResponse.json({ announcements: rows, active_members: total }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — post an announcement and notify the team. Body: { title, body } */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const title = String(b.title || "").trim();
  const body = String(b.body || "").trim();
  if (!title || !body) return NextResponse.json({ error: "Add a title and a message." }, { status: 400 });

  const rows = await sql`INSERT INTO announcements (title, body, created_by) VALUES (${title}, ${body}, ${admin.name}) RETURNING id`;
  // notify all active members
  const members = await sql`SELECT id FROM team_members WHERE active = true`;
  for (const m of members as { id: number }[]) {
    await createNotification({ memberId: m.id, kind: "announcement", title: "New announcement", body: title, link: "/announcements" });
  }
  await logAudit("announcement_create", { entity: "announcement", entityId: rows[0].id }, admin);
  return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
}
