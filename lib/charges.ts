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

export async function chargeRenterForRental(opts: {
  rentalId: number;
  amount: number;
  kind: "repair" | "replacement";
  description: string;
  origin: string;
}): Promise<ChargeResult> {
  const { rentalId, amount, kind, description, origin } = opts;
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
      { idempotencyKey: `charge_${kind}_${rentalId}` }
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

async function flagUncollected(
  stripe: Stripe,
  r: { id: number; customer_id: number | null; stripe_customer_id: string | null },
  cents: number,
  amount: number,
  kind: "repair" | "replacement",
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
