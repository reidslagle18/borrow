import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/**
 * Starts an in-person charge for a checkout transaction on the Terminal reader.
 * Server-driven: creates a card_present PaymentIntent and tells the reader to
 * collect it (the customer taps). In test mode the tap is simulated so the
 * flow can be exercised without hardware.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const b = await request.json();
  if (!b.transaction_id || !b.reader_id) {
    return NextResponse.json(
      { error: "transaction_id and reader_id are required" },
      { status: 400 }
    );
  }

  const tx = (
    await sql`SELECT id, total, customer_id, payment_status FROM transactions WHERE id = ${b.transaction_id}`
  )[0];
  if (!tx) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }
  const amount = Math.round(Number(tx.total) * 100);

  // Nothing to charge (e.g. fully covered by credits) — mark paid immediately.
  if (amount <= 0) {
    await markPaid(Number(tx.id), null);
    return NextResponse.json({ payment_intent_id: null, status: "succeeded" });
  }

  // Link (or create) a Stripe customer so the card can be saved for later
  // off-session charges (late fees / damage), same as the online + card-on-file
  // flows. Only possible when the checkout has a customer on it.
  let stripeCustomerId: string | undefined;
  if (tx.customer_id) {
    const c = await sql`SELECT id, name, email, stripe_customer_id FROM customers WHERE id = ${tx.customer_id}`;
    const cust = c[0];
    stripeCustomerId = cust?.stripe_customer_id || undefined;
    if (cust && !stripeCustomerId) {
      const created = await stripe.customers.create({
        name: cust.name || undefined,
        email: cust.email || undefined,
        metadata: { customer_id: String(cust.id) },
      });
      stripeCustomerId = created.id;
      await sql`UPDATE customers SET stripe_customer_id = ${created.id} WHERE id = ${cust.id}`;
    }
  }

  const pi = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    customer: stripeCustomerId,
    // With a customer attached, save a reusable card generated from the tap so
    // the late-fee / damage engine can charge it off-session later.
    ...(stripeCustomerId ? { setup_future_usage: "off_session" as const } : {}),
    metadata: { transaction_id: String(tx.id) },
  });

  await stripe.terminal.readers.processPaymentIntent(b.reader_id, {
    payment_intent: pi.id,
  });

  // Test mode: simulate the customer tapping a card on the simulated reader.
  if ((process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test")) {
    try {
      await stripe.testHelpers.terminal.readers.presentPaymentMethod(b.reader_id);
    } catch {
      /* real reader or already presented — ignore */
    }
  }

  return NextResponse.json({ payment_intent_id: pi.id, status: "processing" });
}

async function markPaid(transactionId: number, piId: string | null) {
  await sql`
    UPDATE transactions
    SET payment_status = 'collected', payment_method = 'terminal', payment_ref = ${piId}
    WHERE id = ${transactionId}
  `;
  await sql`UPDATE rentals SET paid = true WHERE transaction_id = ${transactionId}`;
}
