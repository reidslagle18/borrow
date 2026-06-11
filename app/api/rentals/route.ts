import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { createBooking } from "@/lib/bookings";

export async function GET(request: Request) {
  await ensureSchema();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // Everything live (reserved/active) plus anything overlapping the window.
  const rows =
    from && to
      ? await sql`
          SELECT r.*, c.name AS customer_name, i.brand, i.size, i.color, i.photo_url
          FROM rentals r
          LEFT JOIN customers c ON c.id = r.customer_id
          JOIN items i ON i.id = r.item_id
          WHERE r.status IN ('reserved','active')
             OR (r.status = 'completed' AND r.start_date <= ${to} AND r.due_date >= ${from})
          ORDER BY r.start_date ASC
        `
      : await sql`
          SELECT r.*, c.name AS customer_name, i.brand, i.size, i.color, i.photo_url
          FROM rentals r
          LEFT JOIN customers c ON c.id = r.customer_id
          JOIN items i ON i.id = r.item_id
          WHERE r.status IN ('reserved','active')
          ORDER BY r.start_date ASC
        `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json();

  const result = await createBooking({
    item_id: b.item_id,
    customer_id: b.customer_id ?? null,
    start_date: b.start_date,
    due_date: b.due_date,
    rental_price: b.rental_price,
    damage_waiver: !!b.damage_waiver,
    notes: b.notes || null,
    source: "studio",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, conflicts: result.conflicts },
      { status: result.status }
    );
  }
  return NextResponse.json(result.rental, { status: 201 });
}
