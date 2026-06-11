import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

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

  if (!b.item_id || !b.start_date || !b.due_date || b.rental_price == null) {
    return NextResponse.json(
      { error: "item_id, start_date, due_date and rental_price are required" },
      { status: 400 }
    );
  }
  if (b.due_date < b.start_date) {
    return NextResponse.json(
      { error: "Due date can't be before the pickup date" },
      { status: 400 }
    );
  }

  // Double-booking guard: any live rental for this piece overlapping these dates?
  const conflicts = await sql`
    SELECT r.id, r.start_date, r.due_date, c.name AS customer_name
    FROM rentals r
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.item_id = ${b.item_id}
      AND r.status IN ('reserved','active')
      AND r.start_date <= ${b.due_date}
      AND r.due_date >= ${b.start_date}
  `;
  if (conflicts.length > 0) {
    return NextResponse.json(
      { error: "This piece is already booked for those dates", conflicts },
      { status: 409 }
    );
  }

  const rows = await sql`
    INSERT INTO rentals (
      item_id, customer_id, start_date, due_date, status,
      rental_price, damage_waiver, notes
    ) VALUES (
      ${b.item_id}, ${b.customer_id ?? null}, ${b.start_date}, ${b.due_date},
      'reserved', ${b.rental_price}, ${!!b.damage_waiver}, ${b.notes || null}
    )
    RETURNING *
  `;

  // Reflect the booking on the piece if it's currently on the rack.
  await sql`
    UPDATE items SET status = 'reserved', updated_at = now()
    WHERE id = ${b.item_id} AND status = 'available'
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
