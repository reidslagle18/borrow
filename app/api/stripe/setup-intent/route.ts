import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe, ensureStripeCustomer } from "@/lib/stripe";

/**
 * Ensures the customer has a Stripe Customer, then creates a SetupIntent so the
 * checkout page can save a card for off-session (future) charges.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const b = await request.json();
  if (!b.customer_id) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }

  const rows = await sql`SELECT id FROM customers WHERE id = ${b.customer_id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Verify/recreate the Stripe customer for the current mode so a stale id
  // (e.g. created in test mode) can't break saving a card.
  const stripeCustomerId = await ensureStripeCustomer(stripe, b.customer_id);
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const si = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { borrow_customer_id: String(b.customer_id) },
  });

  return NextResponse.json({ clientSecret: si.client_secret, stripeCustomerId });
}
