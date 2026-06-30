import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { fulfillReservation } from "@/lib/bookings";
import { sweepPendingPayouts } from "@/lib/connect";
import type Stripe from "stripe";

// Stripe calls this unauthenticated; it's verified by signature instead.
// (Exempted from the studio auth gate in proxy.ts.)
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }

  const sig = request.headers.get("stripe-signature");
  const body = await request.text(); // raw body required for signature check
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", secret);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  await ensureSchema();

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { id: string };
      await fulfillReservation(session.id);
    } else if (event.type === "account.updated") {
      // A consignor's Connect account changed — cache whether they can now
      // receive payouts, and if so, release any payouts queued while they
      // hadn't finished onboarding.
      const acct = event.data.object as Stripe.Account;
      const ready =
        !!acct.payouts_enabled && acct.capabilities?.transfers === "active";
      const rows = await sql`
        UPDATE consignors SET payouts_enabled = ${ready}
        WHERE stripe_account_id = ${acct.id}
        RETURNING id
      `;
      if (ready && rows.length > 0) {
        await sweepPendingPayouts(Number(rows[0].id));
      }
    }
    // Phase 2 will add: payment_intent.succeeded / payment_intent.payment_failed
    // for the off-session late-fee + replacement charges.
  } catch (err) {
    // Log but still 200 so Stripe doesn't hammer retries on a transient error.
    console.error("[stripe webhook] handler error:", (err as Error).message);
  }

  return NextResponse.json({ received: true });
}
