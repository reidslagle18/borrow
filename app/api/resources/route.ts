import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

/** GET — active resources (training docs + policies). Any signed-in user. */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const rows = await sql`
    SELECT id, kind, title, body, url, position,
           to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS updated_at
    FROM resources WHERE archived_at IS NULL
    ORDER BY kind ASC, position ASC, created_at ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/** POST — create a resource (admin). Body: { kind: 'doc'|'policy', title, body?, url? } */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const kind = b.kind === "policy" ? "policy" : "doc";
  const title = String(b.title || "").trim();
  if (!title) return NextResponse.json({ error: "Add a title." }, { status: 400 });
  const rows = await sql`
    INSERT INTO resources (kind, title, body, url, position)
    VALUES (${kind}, ${title}, ${b.body || null}, ${b.url || null},
            ${Number(b.position) || 0})
    RETURNING id
  `;
  await logAudit("resource_create", { entity: "resource", entityId: rows[0].id, detail: { kind } }, admin);
  return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
}
