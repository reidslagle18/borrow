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

  if (!b.barcode || !b.brand || !b.size || !b.tier || b.rental_price == null) {
    return NextResponse.json(
      { error: "barcode, brand, size, tier and rental_price are required" },
      { status: 400 }
    );
  }

  const id = await nextItemId();
  const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
  const cover = b.photo_url || photos[0] || null;
  try {
    const rows = await sql`
      INSERT INTO items (
        id, barcode, brand, description, size, color, fabric, fit_notes,
        silhouette, tier, rental_price, purchase_cost, retail_value,
        acquisition_date, source, condition_notes, ownership, consignor_id,
        event_types, status, location, photo_url, photos
      ) VALUES (
        ${id}, ${String(b.barcode).trim()}, ${b.brand}, ${b.description || null},
        ${b.size}, ${b.color || null}, ${b.fabric || null}, ${b.fit_notes || null},
        ${b.silhouette || null}, ${b.tier}, ${b.rental_price},
        ${b.purchase_cost ?? null}, ${b.retail_value ?? null},
        ${b.acquisition_date || null}, ${b.source || null},
        ${b.condition_notes || null}, ${b.ownership || "owned"},
        ${b.ownership === "consignment" ? b.consignor_id ?? null : null},
        ${b.event_types ?? []}, ${b.status || "available"}, ${b.location || null},
        ${cover}, ${photos}
      )
      RETURNING *
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "That barcode is already used by another piece" },
        { status: 409 }
      );
    }
    throw err;
  }
}
