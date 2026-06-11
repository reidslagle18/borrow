import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const rows = await sql`
    SELECT i.*, c.name AS consignor_name
    FROM items i
    LEFT JOIN consignors c ON c.id = i.consignor_id
    WHERE i.id = ${id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

// Full update — the edit form always sends the complete item.
export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();

  if (!b.brand || !b.size || !b.tier || b.rental_price == null) {
    return NextResponse.json(
      { error: "brand, size, tier and rental_price are required" },
      { status: 400 }
    );
  }

  const rows = await sql`
    UPDATE items SET
      brand = ${b.brand},
      size = ${b.size},
      color = ${b.color || null},
      tier = ${b.tier},
      rental_price = ${b.rental_price},
      purchase_cost = ${b.purchase_cost ?? null},
      condition_notes = ${b.condition_notes || null},
      ownership = ${b.ownership || "owned"},
      consignor_id = ${b.ownership === "consignment" ? b.consignor_id ?? null : null},
      event_types = ${b.event_types ?? []},
      status = ${b.status || "available"},
      photo_url = ${b.photo_url || null},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const rows = await sql`DELETE FROM items WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
