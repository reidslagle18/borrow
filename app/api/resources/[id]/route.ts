import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — edit, reorder, or archive a resource (admin). Never hard-deleted. */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { id } = await params;
  const rid = Number(id);
  const b = await request.json().catch(() => ({}));

  if (typeof b.title === "string" && b.title.trim())
    await sql`UPDATE resources SET title = ${b.title.trim()}, updated_at = now() WHERE id = ${rid}`;
  if ("body" in b) await sql`UPDATE resources SET body = ${b.body || null}, updated_at = now() WHERE id = ${rid}`;
  if ("url" in b) await sql`UPDATE resources SET url = ${b.url || null}, updated_at = now() WHERE id = ${rid}`;
  if ("position" in b) await sql`UPDATE resources SET position = ${Number(b.position) || 0}, updated_at = now() WHERE id = ${rid}`;
  if (b.archive) await sql`UPDATE resources SET archived_at = now(), updated_at = now() WHERE id = ${rid}`;

  await logAudit("resource_update", { entity: "resource", entityId: rid }, admin);
  return NextResponse.json({ ok: true });
}
