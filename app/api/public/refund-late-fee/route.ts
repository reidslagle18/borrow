import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { refundLateFeesForRental } from "@/lib/charges";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY): refund late fees charged on a
 * rental back to the renter's card (and void any uncollected ones). By default
 * refunds ALL of them (down_to = 0) and zeroes the recorded fee — same as the
 * studio's "Refund late fee" button. Pass `down_to` to keep that many dollars of
 * late fee collected and refund only the excess (e.g. closed-day overcharges).
 *
 * Body: { rental_id: number, down_to?: number }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const rentalId = Number(b.rental_id);
  if (!rentalId) {
    return NextResponse.json({ error: "rental_id required" }, { status: 400 });
  }
  const downTo = Math.max(0, Number(b.down_to) || 0);
  const r = await refundLateFeesForRental(rentalId, downTo);
  if (r.error) {
    return NextResponse.json(
      { error: `Couldn't refund: ${r.error}`, refunded: r.refunded },
      { status: 400 }
    );
  }
  await sql`UPDATE rentals SET late_fee = ${downTo}, updated_at = now() WHERE id = ${rentalId}`;
  return NextResponse.json({ ok: true, rental_id: rentalId, down_to: downTo, refunded: r.refunded, charges: r.count });
}
