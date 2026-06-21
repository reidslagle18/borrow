import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";

type Ctx = { params: Promise<{ id: string }> };

// Looks up by the internal BRW id OR the scannable barcode, so the detail
// page (/inventory/[barcode]) and any id-based caller both resolve here.
export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const rows = await sql`
    SELECT i.*, c.name AS consignor_name, a.name AS ambassador_name
    FROM items i
    LEFT JOIN consignors c ON c.id = i.consignor_id
    LEFT JOIN ambassadors a ON a.id = i.ambassador_id
    WHERE i.id = ${id} OR i.barcode = ${id}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

// Full update — the edit form always sends the complete item.
// Exception: { action: "rack" } puts a cleaned piece back in rotation.
export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();

  if (b.action === "return_to_consignor") {
    const live = await sql`
      SELECT id FROM rentals
      WHERE item_id = ${id} AND status IN ('reserved','active')
    `;
    if (live.length > 0) {
      return NextResponse.json(
        { error: "This piece has live bookings — cancel or complete them first" },
        { status: 400 }
      );
    }
    const rows = await sql`
      UPDATE items SET
        status = 'retired',
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || CURRENT_DATE || '] Returned to consignor',
        updated_at = now()
      WHERE id = ${id} AND ownership = 'consignment'
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only consignment pieces can be returned to a consignor" },
        { status: 400 }
      );
    }
    // Opt-in dry clean at retrieval — only when the consignor agreed. Deducts
    // the Cleaning & Care Fee amount from their earnings.
    if (b.dry_clean && rows[0].consignor_id) {
      const fee = (await getProgram()).cleaning_fee;
      await sql`
        INSERT INTO consignor_charges (consignor_id, amount, kind, item_id, note)
        VALUES (${rows[0].consignor_id}, ${fee}, 'retrieval', ${id}, 'Dry clean at retrieval')
      `;
    }
    return NextResponse.json(rows[0]);
  }

  // A consignor borrows their own piece back — free, open-ended, blocked from
  // others until returned. Stays in the system as 'with_consignor'.
  if (b.action === "consignor_take") {
    const live = await sql`
      SELECT id FROM rentals WHERE item_id = ${id} AND status IN ('reserved','active')
    `;
    if (live.length > 0) {
      return NextResponse.json(
        { error: "This piece has live bookings — cancel or complete them first" },
        { status: 400 }
      );
    }
    const rows = await sql`
      UPDATE items SET
        status = 'with_consignor',
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || CURRENT_DATE || '] Out to consignor — must be returned clean',
        updated_at = now()
      WHERE id = ${id} AND ownership = 'consignment'
        AND status NOT IN ('retired','rented')
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only an available consignment piece can go out to its consignor" },
        { status: 400 }
      );
    }
    return NextResponse.json(rows[0]);
  }

  if (b.action === "consignor_return") {
    const rows = await sql`
      UPDATE items SET
        status = 'available',
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || CURRENT_DATE || '] Returned by consignor',
        updated_at = now()
      WHERE id = ${id} AND status = 'with_consignor'
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "This piece isn't currently out to its consignor" },
        { status: 400 }
      );
    }
    return NextResponse.json(rows[0]);
  }

  if (b.action === "rack") {
    const rows = await sql`
      UPDATE items SET status = CASE
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${id} AND status = 'active') THEN 'rented'
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${id} AND status = 'reserved') THEN 'reserved'
        ELSE 'available'
      END, updated_at = now()
      WHERE id = ${id} AND status = 'cleaning'
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only pieces in cleaning can go back on the rack" },
        { status: 400 }
      );
    }
    return NextResponse.json(rows[0]);
  }

  if (!b.barcode || !b.brand || !b.size || !b.tier || b.rental_price == null) {
    return NextResponse.json(
      { error: "barcode, brand, size, tier and rental_price are required" },
      { status: 400 }
    );
  }

  const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
  const cover = b.photo_url || photos[0] || null;
  // Whole-dollar prices, rounded up — no stray cents.
  const rentalPrice = Math.ceil(Number(b.rental_price));
  const ceilOrNull = (v: unknown) =>
    v == null || v === "" ? null : Math.ceil(Number(v));
  const purchaseCost = ceilOrNull(b.purchase_cost);
  const retailValue = ceilOrNull(b.retail_value);
  // Stamp the retirement date when a piece is first moved to retired.
  const retiredAt = b.status === "retired" ? b.retired_at ?? null : null;

  let rows;
  try {
    rows = await sql`
      UPDATE items SET
        barcode = ${String(b.barcode).trim()},
        name = ${b.name || null},
        brand = ${b.brand},
        description = ${b.description || null},
        size = ${b.size},
        color = ${b.color || null},
        fabric = ${b.fabric || null},
        fit_notes = ${b.fit_notes || null},
        silhouette = ${b.silhouette || null},
        new_with_tags = ${!!b.new_with_tags},
        ambassador_id = ${b.ambassador_id ?? null},
        tier = ${b.tier},
        rental_price = ${rentalPrice},
        purchase_cost = ${purchaseCost},
        retail_value = ${retailValue},
        acquisition_date = ${b.acquisition_date || null},
        source = ${b.source || null},
        condition_notes = ${b.condition_notes || null},
        ownership = ${b.ownership || "owned"},
        consignor_id = ${b.ownership === "consignment" ? b.consignor_id ?? null : null},
        event_types = ${b.event_types ?? []},
        status = ${b.status || "available"},
        location = ${b.location || null},
        photo_url = ${cover},
        photos = ${photos},
        retired_at = CASE
          WHEN ${b.status} = 'retired' THEN COALESCE(${retiredAt}, retired_at, CURRENT_DATE)
          ELSE NULL
        END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "That barcode is already used by another piece" },
        { status: 409 }
      );
    }
    throw err;
  }
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
