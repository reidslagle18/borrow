import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { createBooking, findOrCreateCustomer } from "@/lib/bookings";

/**
 * Booking endpoint for the customer-facing site (server-to-server).
 * Requires the x-api-key header — give BOOKING_API_KEY only to the
 * customer site's backend, never expose it in browser code.
 *
 * The rental price is always taken from the piece itself, and the same
 * double-booking guard as the studio dashboard applies, so a web booking
 * can never collide with one made in-store.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSchema();
  const b = await request.json();

  if (!b.customer?.name?.trim()) {
    return NextResponse.json(
      { error: "customer.name is required" },
      { status: 400 }
    );
  }

  const item = await sql`
    SELECT id, rental_price FROM items WHERE id = ${b.item_id ?? ""}
  `;
  if (item.length === 0) {
    return NextResponse.json({ error: "Piece not found" }, { status: 404 });
  }

  const customerId = await findOrCreateCustomer({
    name: b.customer.name,
    phone: b.customer.phone,
    email: b.customer.email,
  });

  const result = await createBooking({
    item_id: b.item_id,
    customer_id: customerId,
    start_date: b.start_date,
    due_date: b.due_date,
    rental_price: Number(item[0].rental_price),
    damage_waiver: !!b.damage_waiver,
    notes: b.notes || null,
    source: "web",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, conflicts: result.conflicts },
      { status: result.status }
    );
  }
  return NextResponse.json(result.rental, { status: 201 });
}
