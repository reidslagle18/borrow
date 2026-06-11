import { NextResponse } from "next/server";
import { sql, ensureSchema, nextItemId } from "@/lib/db";

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT i.*, c.name AS consignor_name
    FROM items i
    LEFT JOIN consignors c ON c.id = i.consignor_id
    ORDER BY i.created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json();

  if (!b.brand || !b.size || !b.tier || b.rental_price == null) {
    return NextResponse.json(
      { error: "brand, size, tier and rental_price are required" },
      { status: 400 }
    );
  }

  const id = await nextItemId();
  const rows = await sql`
    INSERT INTO items (
      id, brand, size, color, tier, rental_price, purchase_cost,
      condition_notes, ownership, consignor_id, event_types, status, photo_url
    ) VALUES (
      ${id}, ${b.brand}, ${b.size}, ${b.color || null}, ${b.tier},
      ${b.rental_price}, ${b.purchase_cost ?? null}, ${b.condition_notes || null},
      ${b.ownership || "owned"},
      ${b.ownership === "consignment" ? b.consignor_id ?? null : null},
      ${b.event_types ?? []}, ${b.status || "available"}, ${b.photo_url || null}
    )
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
