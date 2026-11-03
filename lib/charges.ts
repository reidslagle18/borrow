import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/**
 * Charge a renter's saved card off-session for a repair cost or a replacement
 * value. If the card charges cleanly we record it succeeded. If it fails (or
 * there's no saved card), we DON'T block anything: we record the charge as
 * uncollected, generate a Stripe payment link to send the renter, flag the
 * rental for follow-up, and add the amount to the customer's outstanding
 * balance. The caller decides what else happens (e.g. the consignor is paid
 * regardless).
 */
export type ChargeResult = {
  status: "succeeded" | "uncollected" | "skipped";
  paymentLinkUrl?: string | null;
};

export type ChargeKind =
  | "late_fee"
  | "replacement"
  | "repair"
  | "hanger"
  | "garment_bag";

export async function chargeRenterForRental(opts: {
  rentalId: number;
  amount: number;
  kind: ChargeKind;
  description: string;
  origin: string;
  // Override for repeatable charges (e.g. late fees accrue per day); defaults
  // to one-per-rental-per-kind so repair/replacement/hanger can't double-charge.
  idempotencyKey?: string;
}): Promise<ChargeResult> {
  const { rentalId, amount, kind, description, origin } = opts;
  const idempotencyKey = opts.idempotencyKey || `charge_${kind}_${rentalId}`;
  const stripe = getStripe();
  if (!stripe || amount <= 0) return { status: "skipped" };

  const r = (
    await sql`
      SELECT id, customer_id, stripe_customer_id, stripe_payment_method_id
      FROM rentals WHERE id = ${rentalId}
    `
  )[0] as
    | {
        id: number;
        customer_id: number | null;
        stripe_customer_id: string | null;
        stripe_payment_method_id: string | null;
      }
    | undefined;
  if (!r) return { status: "skipped" };

  const cents = Math.round(amount * 100);

  // No saved card → can't auto-charge; go straight to a follow-up link.
  if (!r.stripe_customer_id || !r.stripe_payment_method_id) {
    return flagUncollected(stripe, r, cents, amount, kind, description, origin, null);
  }

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: cents,
        currency: "usd",
        customer: r.stripe_customer_id,
        payment_method: r.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description,
        metadata: { rental_id: String(rentalId), kind },
      },
      { idempotencyKey }
    );
    if (pi.status === "succeeded") {
      await sql`
        INSERT INTO customer_charges (customer_id, rental_id, amount, kind, status, stripe_payment_intent_id)
        VALUES (${r.customer_id}, ${rentalId}, ${amount}, ${kind}, 'succeeded', ${pi.id})
      `;
      if (kind === "replacement") {
        await sql`UPDATE rentals SET replacement_charged = true WHERE id = ${rentalId}`;
      }
      return { status: "succeeded" };
    }
    // Needs further action off-session → treat as uncollected.
    return flagUncollected(stripe, r, cents, amount, kind, description, origin, pi.id);
  } catch (err) {
    const piId =
      (err as Stripe.errors.StripeCardError)?.payment_intent?.id ?? null;
    return flagUncollected(stripe, r, cents, amount, kind, description, origin, piId);
  }
}

/**
 * Refund late fees already charged on a rental, bringing the net collected late
 * fee DOWN to `downTo` dollars (default 0 = refund everything). Used when a late
 * fee is waived or lowered at check-in, and by the manual "Refund late fee"
 * button. Refunds succeeded charges newest-first (partial-refunding the last one
 * if needed), stamps refunded_amount/refunded_at, and winds back the rental's
 * late_fee_charged so the daily job doesn't re-bill. When fully waiving
 * (downTo = 0) it ALSO voids any still-uncollected (failed) late-fee charges and
 * reverses their outstanding balance, so a waived fee is never chased.
 * Idempotent and safe to call when there's nothing to refund.
 */
export async function refundLateFeesForRental(
  rentalId: number,
  downTo = 0
): Promise<{ refunded: number; count: number; error?: string }> {
  const stripe = getStripe();
  const rows = (await sql`
    SELECT id, amount, refunded_amount, stripe_payment_intent_id
    FROM customer_charges
    WHERE rental_id = ${rentalId}
      AND kind = 'late_fee'
      AND status = 'succeeded'
      AND (amount - refunded_amount) > 0.005
    ORDER BY id DESC
  `) as {
    id: number;
    amount: string | number;
    refunded_amount: string | number;
    stripe_payment_intent_id: string | null;
  }[];

  const collectedCents = rows.reduce(
    (s, r) => s + Math.round((Number(r.amount) - Number(r.refunded_amount)) * 100),
    0
  );
  let needCents = Math.max(0, collectedCents - Math.round(downTo * 100));

  let refundedCents = 0;
  let count = 0;
  for (const r of rows) {
    if (needCents <= 0) break;
    const remainingCents = Math.round(
      (Number(r.amount) - Number(r.refunded_amount)) * 100
    );
    const thisCents = Math.min(remainingCents, needCents);
    if (thisCents <= 0) continue;
    const pi = r.stripe_payment_intent_id;
    if (!stripe || typeof pi !== "string" || !pi.startsWith("pi_")) {
      // No card charge to reverse (shouldn't happen for a 'succeeded' row) — skip.
      continue;
    }
    try {
      await stripe.refunds.create(
        { payment_intent: pi, amount: thisCents },
        {
          idempotencyKey: `latefee_refund_${r.id}_${Math.round(
            Number(r.refunded_amount) * 100
          )}_${thisCents}`,
        }
      );
    } catch (err) {
      return {
        refunded: refundedCents / 100,
        count,
        error: (err as Error).message,
      };
    }
    const newRefunded =
      Math.round(Number(r.refunded_amount) * 100 + thisCents) / 100;
    await sql`
      UPDATE customer_charges SET
        refunded_amount = ${newRefunded},
        refunded_at = CASE WHEN ${newRefunded} >= amount THEN now() ELSE refunded_at END
      WHERE id = ${r.id}
    `;
    refundedCents += thisCents;
    needCents -= thisCents;
    count++;
  }

  if (refundedCents > 0) {
    await sql`
      UPDATE rentals
      SET late_fee_charged = GREATEST(late_fee_charged - ${refundedCents / 100}, 0),
          updated_at = now()
      WHERE id = ${rentalId}
    `;
  }

  // Full waive: also void any uncollected (failed) late-fee charges so the renter
  // isn't left with a payment link / outstanding balance for a fee we've waived.
  if (downTo <= 0) {
    const failed = (await sql`
      SELECT id, customer_id, amount FROM customer_charges
      WHERE rental_id = ${rentalId} AND kind = 'late_fee'
        AND status = 'failed' AND refunded_at IS NULL
    `) as { id: number; customer_id: number | null; amount: string | number }[];
    for (const f of failed) {
      await sql`
        UPDATE customer_charges SET refunded_at = now(), refunded_amount = amount
        WHERE id = ${f.id}
      `;
      if (f.customer_id) {
        await sql`
          UPDATE customers
          SET outstanding_balance = GREATEST(outstanding_balance - ${Number(f.amount)}, 0)
          WHERE id = ${f.customer_id}
        `;
      }
    }
  }

  return { refunded: refundedCents / 100, count };
}

async function flagUncollected(
  stripe: Stripe,
  r: { id: number; customer_id: number | null; stripe_customer_id: string | null },
  cents: number,
  amount: number,
  kind: ChargeKind,
  description: string,
  origin: string,
  piId: string | null
): Promise<ChargeResult> {
  let url: string | null = null;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: r.stripe_customer_id || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: cents,
            product_data: { name: description },
          },
        },
      ],
      metadata: { rental_id: String(r.id), kind },
      success_url: `${origin}/returns?paid=1`,
      cancel_url: `${origin}/returns`,
    });
    url = session.url;
  } catch {
    /* link creation is best-effort */
  }

  await sql`
    INSERT INTO customer_charges (customer_id, rental_id, amount, kind, status, stripe_payment_intent_id, payment_link_url)
    VALUES (${r.customer_id}, ${r.id}, ${amount}, ${kind}, 'failed', ${piId}, ${url})
  `;
  await sql`
    UPDATE rentals SET payment_followup = true, payment_link_url = ${url}
    WHERE id = ${r.id}
  `;
  if (r.customer_id) {
    await sql`UPDATE customers SET outstanding_balance = outstanding_balance + ${amount} WHERE id = ${r.customer_id}`;
  }
  return { status: "uncollected", paymentLinkUrl: url };
}
