import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — archive an announcement (never hard-deleted). Body: { archive: true } */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  if (b.archive) await sql`UPDATE announcements SET archived_at = now() WHERE id = ${Number(id)}`;
  await logAudit("announcement_archive", { entity: "announcement", entityId: Number(id) }, admin);
  return NextResponse.json({ ok: true });
}
