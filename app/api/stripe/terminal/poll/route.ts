import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

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

  const pi = await stripe.paymentIntents.retrieve(b.payment_intent_id, {
    expand: ["latest_charge"],
  });

  if (pi.status === "succeeded") {
    if (b.transaction_id) {
      await sql`
        UPDATE transactions
        SET payment_status = 'collected', payment_method = 'terminal', payment_ref = ${pi.id}
        WHERE id = ${b.transaction_id} AND payment_status <> 'collected'
      `;
      // The tap generated a reusable card (setup_future_usage) attached to the
      // customer — store it on the rentals so late-fee/damage can charge it
      // off-session later, consistent with the online + card-on-file flows.
      const charge = pi.latest_charge as Stripe.Charge | null;
      const genCard = charge?.payment_method_details?.card_present?.generated_card ?? null;
      const custId = typeof pi.customer === "string" ? pi.customer : null;
      if (genCard && custId) {
        await sql`
          UPDATE rentals
          SET paid = true, stripe_customer_id = ${custId}, stripe_payment_method_id = ${genCard}
          WHERE transaction_id = ${b.transaction_id}
        `;
      } else {
        await sql`UPDATE rentals SET paid = true WHERE transaction_id = ${b.transaction_id}`;
      }
    }
    return NextResponse.json({ status: "succeeded", pi_status: pi.status });
  }

  if (pi.status === "canceled") {
    return NextResponse.json({ status: "canceled", pi_status: pi.status });
  }

  // IMPORTANT: for a card-present PaymentIntent, `requires_payment_method` is
  // the NORMAL waiting state while the reader collects the card — it is NOT a
  // decline. The only reliable decline signal is the reader's ACTION status, so
  // we consult that (when we know which reader) instead of guessing from the PI.
  if (b.reader_id) {
    try {
      const reader = (await stripe.terminal.readers.retrieve(
        b.reader_id
      )) as Stripe.Terminal.Reader;
      const a = reader.action;
      if (a && a.type === "process_payment_intent") {
        const actionPi =
          typeof a.process_payment_intent?.payment_intent === "string"
            ? a.process_payment_intent.payment_intent
            : a.process_payment_intent?.payment_intent?.id;
        // Only act on the action for THIS payment.
        if (!actionPi || actionPi === b.payment_intent_id) {
          if (a.status === "failed") {
            return NextResponse.json({
              status: "declined",
              pi_status: pi.status,
              message: a.failure_message || null,
            });
          }
          // in_progress (still tapping) or succeeded (PI not flipped yet) → wait.
        }
      }
    } catch {
      /* couldn't read the reader — fall through and keep waiting */
    }
  }

  // Still collecting / processing — keep polling.
  return NextResponse.json({ status: "processing", pi_status: pi.status });
}
