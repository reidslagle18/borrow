import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — flag/unflag a shift note as needs-attention, or archive it (never hard-deleted). */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { id } = await params;
  const nid = Number(id);
  const b = await request.json().catch(() => ({}));

  if ("needs_attention" in b)
    await sql`UPDATE shift_notes SET needs_attention = ${!!b.needs_attention} WHERE id = ${nid}`;
  if (b.archive)
    await sql`UPDATE shift_notes SET archived_at = now() WHERE id = ${nid}`;

  await logAudit("shift_note_update", { entity: "shift_note", entityId: nid }, admin);
  return NextResponse.json({ ok: true });
}
