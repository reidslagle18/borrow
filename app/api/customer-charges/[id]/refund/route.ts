import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin-only (gated by proxy.ts): refund a renter off-session charge (e.g. a
 * late fee) back to their card. Refunds the charge's PaymentIntent, stamps
 * refunded_at (so it drops out of Net Take), and — for a late fee — winds back
 * the rental's late_fee_charged so the daily job doesn't treat it as still paid.
 * Idempotent per charge.
 */
export async function POST(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  const ch = (
    await sql`SELECT id, amount, kind, status, stripe_payment_intent_id, rental_id, refunded_at
              FROM customer_charges WHERE id = ${Number(id)}`
  )[0];
  if (!ch) return NextResponse.json({ error: "Charge not found" }, { status: 404 });
  if (ch.refunded_at) return NextResponse.json({ ok: true, already: true }); // idempotent
  if (ch.status !== "succeeded") {
    return NextResponse.json({ error: "Only a collected charge can be refunded." }, { status: 400 });
  }
  const pi = ch.stripe_payment_intent_id;
  if (typeof pi !== "string" || !pi.startsWith("pi_")) {
    return NextResponse.json({ error: "No card charge on file to refund." }, { status: 400 });
  }

  const amount = Number(ch.amount);
  try {
    await stripe.refunds.create(
      { payment_intent: pi, amount: Math.round(amount * 100) },
      { idempotencyKey: `charge_refund_${ch.id}` }
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Stripe couldn't refund this: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  await sql`UPDATE customer_charges SET refunded_at = now() WHERE id = ${ch.id}`;
  // A refunded late fee should no longer count as billed on the rental.
  if (ch.kind === "late_fee" && ch.rental_id) {
    await sql`
      UPDATE rentals SET late_fee_charged = GREATEST(late_fee_charged - ${amount}, 0), updated_at = now()
      WHERE id = ${ch.rental_id}
    `;
  }
  return NextResponse.json({ ok: true, amount });
}
