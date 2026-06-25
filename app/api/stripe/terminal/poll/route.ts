import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/**
 * Polled by the checkout screen after a charge starts. Returns the status of
 * the card_present PaymentIntent; once it succeeds, marks the transaction paid
 * and flips its rentals to paid (idempotent).
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const b = await request.json();
  if (!b.payment_intent_id) {
    return NextResponse.json({ error: "payment_intent_id required" }, { status: 400 });
  }

  const pi = await stripe.paymentIntents.retrieve(b.payment_intent_id);

  if (pi.status === "succeeded") {
    if (b.transaction_id) {
      await sql`
        UPDATE transactions
        SET payment_status = 'collected', payment_method = 'terminal', payment_ref = ${pi.id}
        WHERE id = ${b.transaction_id} AND payment_status <> 'collected'
      `;
      await sql`UPDATE rentals SET paid = true WHERE transaction_id = ${b.transaction_id}`;
    }
    return NextResponse.json({ status: "succeeded", pi_status: pi.status });
  }

  if (pi.status === "canceled" || pi.status === "requires_payment_method") {
    return NextResponse.json({ status: "failed", pi_status: pi.status });
  }

  // requires_action / requires_confirmation / processing → still waiting on the tap
  return NextResponse.json({ status: "processing", pi_status: pi.status });
}
