import Stripe from "stripe";

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
