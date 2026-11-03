import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;

  const customers = await sql`SELECT * FROM customers WHERE id = ${id}`;
  if (customers.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rentals = await sql`
    SELECT r.*, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.size, i.color, i.photo_url,
      COALESCE((
        SELECT SUM(cc.amount - cc.refunded_amount)
        FROM customer_charges cc
        WHERE cc.rental_id = r.id AND cc.kind = 'late_fee'
          AND cc.status = 'succeeded' AND (cc.amount - cc.refunded_amount) > 0
      ), 0) AS late_fee_refundable
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    WHERE r.customer_id = ${id}
    ORDER BY r.start_date DESC
  `;
  const spent = rentals
    .filter((r) => r.status === "active" || r.status === "completed")
    .reduce(
      (s, r) =>
        s +
        Number(r.rental_price) +
        (Number(r.cleaning_fee) || (r.damage_waiver ? 5 : 0)) +
        Number(r.late_fee),
      0
    );
  const credited = await sql`
    SELECT rental_id FROM store_credit_entries
    WHERE customer_id = ${id} AND reason = 'post' AND rental_id IS NOT NULL
  `;
  // Full store-credit activity log — grants (+) and redemptions (−), newest
  // first, with a readable reference to the rental/order each touched.
  const creditEntries = await sql`
    SELECT e.id, e.amount, e.reason, e.note, e.rental_id, e.transaction_id,
           to_char(e.created_at, 'YYYY-MM-DD') AS created_at,
           COALESCE(NULLIF(ri.name, ''), ri.brand) AS rental_item
    FROM store_credit_entries e
    LEFT JOIN rentals r ON r.id = e.rental_id
    LEFT JOIN items ri ON ri.id = r.item_id
    WHERE e.customer_id = ${id}
    ORDER BY e.created_at DESC, e.id DESC
  `;
  return NextResponse.json({
    ...customers[0],
    rentals,
    spent,
    credited_rental_ids: credited.map((r) => r.rental_id),
    credit_entries: creditEntries,
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const flag = b.flag === "vip" || b.flag === "problem" ? b.flag : null;
  const rows = await sql`
    UPDATE customers SET
      name = ${b.name.trim()},
      phone = ${b.phone || null},
      email = ${b.email || null},
      instagram = ${b.instagram || null},
      flag = ${flag},
      notes = ${b.notes || null}
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}
