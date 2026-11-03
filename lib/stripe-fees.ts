import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/**
 * Fill in the ACTUAL Stripe processing fee for card transactions that don't have
 * it recorded yet. The fee lives on the charge's balance transaction, so we
 * retrieve the PaymentIntent → latest_charge → balance_transaction and store its
 * `fee`. Best-effort and idempotent: only touches transactions where stripe_fee
 * is NULL, and leaves it NULL (to retry later) if the balance transaction isn't
 * available yet. Returns how many it filled.
 */
export async function syncStripeFees(limit = 100): Promise<{ filled: number; pending: number }> {
  const stripe = getStripe();
  if (!stripe) return { filled: 0, pending: 0 };

  const rows = await sql`
    SELECT id, payment_ref FROM transactions
    WHERE stripe_fee IS NULL
      AND payment_ref LIKE 'pi_%'
      AND payment_status IN ('collected', 'refunded')
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  let filled = 0;
  let pending = 0;
  for (const t of rows) {
    try {
      const pi = await stripe.paymentIntents.retrieve(String(t.payment_ref), {
        expand: ["latest_charge.balance_transaction"],
      });
      const charge =
        pi.latest_charge && typeof pi.latest_charge === "object"
          ? (pi.latest_charge as Stripe.Charge)
          : null;
      const bt =
        charge && charge.balance_transaction && typeof charge.balance_transaction === "object"
          ? (charge.balance_transaction as Stripe.BalanceTransaction)
          : null;
      if (bt && typeof bt.fee === "number") {
        const fee = Math.round(bt.fee) / 100; // cents → dollars
        await sql`UPDATE transactions SET stripe_fee = ${fee} WHERE id = ${t.id}`;
        filled += 1;
      } else {
        pending += 1; // not settled yet; retry next run
      }
    } catch {
      pending += 1; // transient; leave NULL to retry
    }
  }
  return { filled, pending };
}
