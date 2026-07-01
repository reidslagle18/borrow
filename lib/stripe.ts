import Stripe from "stripe";
import { sql } from "@/lib/db";

let client: Stripe | null = null;

/**
 * Server-side Stripe client. Returns null when STRIPE_SECRET_KEY isn't set, so
 * callers can degrade gracefully (checkout still works without saving a card).
 */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

/**
 * Resolve a usable Stripe Customer id for one of our customers, resilient to
 * stale ids. A stored id created in a different Stripe mode (e.g. test) doesn't
 * exist in live mode and makes Stripe throw "No such customer" — so we verify
 * the stored id still exists in the CURRENT mode, and if it's missing, deleted,
 * or empty, create a fresh customer and persist the new id. Checkout must never
 * fail because of a stale id; it always falls back to a new one.
 *
 * Returns the Stripe customer id, or null when there's no such customer row
 * (e.g. an anonymous walk-in with no customer record).
 */
export async function ensureStripeCustomer(
  stripe: Stripe,
  customerId: number | null | undefined
): Promise<string | null> {
  if (!customerId) return null;
  const rows = await sql`
    SELECT id, name, email, phone, stripe_customer_id FROM customers WHERE id = ${customerId}
  `;
  const cust = rows[0];
  if (!cust) return null;

  const existingId: string | null = cust.stripe_customer_id || null;
  if (existingId) {
    try {
      const found = await stripe.customers.retrieve(existingId);
      // A deleted customer comes back as { deleted: true } rather than throwing.
      if (!(found as Stripe.DeletedCustomer).deleted) return existingId;
    } catch (err) {
      // Only a genuinely-missing customer (wrong mode / deleted) falls through
      // to recreation; anything else (network, auth) is a real error.
      if ((err as { code?: string }).code !== "resource_missing") throw err;
    }
  }

  const created = await stripe.customers.create({
    name: cust.name || undefined,
    email: cust.email || undefined,
    phone: cust.phone || undefined,
    metadata: { borrow_customer_id: String(cust.id) },
  });
  await sql`UPDATE customers SET stripe_customer_id = ${created.id} WHERE id = ${cust.id}`;
  return created.id;
}
