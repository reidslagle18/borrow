import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY): refund a rental's price to the
 * renter's card — an owner courtesy refund that bypasses the 48h policy (e.g.
 * refunding a cancellation made inside the window). Refunds `amount` (defaults to
 * the rental's rental_price) against the checkout session or the transaction's
 * PaymentIntent, and records it on the transaction so Finances sees it.
 * Idempotent per rental via `cancel_refund_<id>`.
 *
 * Body: { rental_id: number, amount?: number }
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
  const rental = (
    await sql`SELECT id, rental_price, stripe_session_id, transaction_id FROM rentals WHERE id = ${rentalId}`
  )[0];
  if (!rental) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }
  const amount =
    b.amount != null && b.amount !== ""
      ? Math.round(Number(b.amount) * 100) / 100
      : Math.round(Number(rental.rental_price) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Nothing to refund" }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }

  let piId: string | null = null;
  if (rental.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(
      rental.stripe_session_id as string,
      { expand: ["payment_intent"] }
    );
    const pi = session.payment_intent;
    piId = typeof pi === "string" ? pi : pi?.id ?? null;
  } else if (rental.transaction_id) {
    const tx = (
      await sql`SELECT payment_ref FROM transactions WHERE id = ${rental.transaction_id}`
    )[0];
    const ref = tx?.payment_ref;
    if (typeof ref === "string" && ref.startsWith("pi_")) piId = ref;
  }
  if (!piId) {
    return NextResponse.json({ error: "No card charge on file to refund." }, { status: 400 });
  }

  try {
    await stripe.refunds.create(
      { payment_intent: piId, amount: Math.round(amount * 100) },
      { idempotencyKey: `cancel_refund_${rentalId}` }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Stripe couldn't refund this: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  if (rental.transaction_id) {
    await sql`
      UPDATE transactions
      SET refund_amount = COALESCE(refund_amount, 0) + ${amount},
          refunded_at = COALESCE(refunded_at, now())
      WHERE id = ${rental.transaction_id}
    `.catch(() => {});
  }

  return NextResponse.json({ ok: true, rental_id: rentalId, refunded: amount });
}
