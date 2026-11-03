import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY). Checks whether a follow-up
 * Stripe Checkout link (from send-charge-link) was actually PAID, and if so
 * records it: a succeeded customer_charges row, flips rentals.replacement_charged
 * / clears payment_followup, and draws down the renter's outstanding_balance by
 * the paid amount. The webhook only fulfills reservation checkouts, so these
 * link payments need this manual reconcile.
 *
 * Body: { rental_id, session_id }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const rentalId = Number(b.rental_id);
  const sessionId = typeof b.session_id === "string" ? b.session_id : "";
  if (!rentalId || !sessionId) {
    return NextResponse.json({ error: "rental_id and session_id required" }, { status: 400 });
  }
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });

  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
  const paid = session.payment_status === "paid";
  const amount = Math.round((session.amount_total ?? 0)) / 100;
  const kind = (session.metadata?.kind as string) || "replacement";
  const pi = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  if (!paid) {
    return NextResponse.json({ ok: true, paid: false, payment_status: session.payment_status, amount });
  }

  const r = (await sql`SELECT id, customer_id FROM rentals WHERE id = ${rentalId}`)[0];
  if (!r) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

  // Record the succeeded charge once (guard on this PaymentIntent).
  const existing = pi
    ? await sql`SELECT id FROM customer_charges WHERE stripe_payment_intent_id = ${pi} AND status = 'succeeded'`
    : [];
  let recorded = false;
  if (existing.length === 0) {
    await sql`
      INSERT INTO customer_charges (customer_id, rental_id, amount, kind, status, stripe_payment_intent_id)
      VALUES (${r.customer_id}, ${rentalId}, ${amount}, ${kind}, 'succeeded', ${pi})
    `;
    recorded = true;
  }
  if (kind === "replacement") {
    await sql`UPDATE rentals SET replacement_charged = true, payment_followup = false WHERE id = ${rentalId}`;
  } else {
    await sql`UPDATE rentals SET payment_followup = false WHERE id = ${rentalId}`;
  }
  if (r.customer_id) {
    await sql`UPDATE customers SET outstanding_balance = GREATEST(outstanding_balance - ${amount}, 0) WHERE id = ${r.customer_id}`;
  }

  return NextResponse.json({ ok: true, paid: true, amount, recorded, payment_intent: pi });
}
