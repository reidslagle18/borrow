import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

/** Aborts an in-progress tap: clears the reader and cancels the PaymentIntent. */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  const b = await request.json().catch(() => ({}));
  if (b.reader_id) {
    await stripe.terminal.readers.cancelAction(b.reader_id).catch(() => {});
  }
  if (b.payment_intent_id) {
    await stripe.paymentIntents.cancel(b.payment_intent_id).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
