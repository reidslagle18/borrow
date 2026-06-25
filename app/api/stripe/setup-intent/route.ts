import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

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

  const rows = await sql`SELECT * FROM customers WHERE id = ${b.customer_id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  const cust = rows[0];

  let stripeCustomerId: string = cust.stripe_customer_id;
  if (!stripeCustomerId) {
    const sc = await stripe.customers.create({
      name: cust.name,
      email: cust.email || undefined,
      phone: cust.phone || undefined,
      metadata: { borrow_customer_id: String(cust.id) },
    });
    stripeCustomerId = sc.id;
    await sql`UPDATE customers SET stripe_customer_id = ${stripeCustomerId} WHERE id = ${cust.id}`;
  }

  const si = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { borrow_customer_id: String(cust.id) },
  });

  return NextResponse.json({ clientSecret: si.client_secret, stripeCustomerId });
}
