import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

// Featured manager (admin only). GET lists featured pieces in order with their
// rental count; PUT saves a new order.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const rows = await sql`
    SELECT i.id, i.barcode, COALESCE(NULLIF(i.name, ''), i.brand) AS label,
           i.size, i.photo_url, i.status, i.ownership, i.approval_status,
           i.rental_count, i.featured_rank
    FROM items i
    WHERE i.featured
    ORDER BY i.featured_rank NULLS LAST, i.created_at ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const { order } = (await request.json().catch(() => ({}))) as { order?: string[] };
  if (!Array.isArray(order)) {
    return NextResponse.json({ error: "order (array of item ids) is required" }, { status: 400 });
  }
  // Assign featured_rank by position. Featured lists are small, so a simple
  // per-row update is fine and clear.
  for (let i = 0; i < order.length; i++) {
    await sql`UPDATE items SET featured_rank = ${i}, updated_at = now()
      WHERE id = ${order[i]} AND featured`;
  }
  await logAudit("featured_reorder", { entity: "featured", detail: { count: order.length } }, admin);
  return NextResponse.json({ ok: true });
}
