import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe, ensureStripeCustomer } from "@/lib/stripe";
import { getProgram } from "@/lib/credits";
import { findOrCreateCustomer } from "@/lib/bookings";

/**
 * Creates a Stripe Checkout Session so a customer can pay the full amount
 * (rental + Cleaning & Care Fee) online to reserve a piece. The card is saved
 * off-session (setup_future_usage) for later late-fee / replacement charges.
 * Server-to-server: requires the x-api-key. The reservation is created only
 * after payment, via /api/public/fulfill and the Stripe webhook.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Payments not configured" }, { status: 400 });
  }
  await ensureSchema();
  const b = await request.json();

  if (!b.customer?.name?.trim() || !b.item_id || !b.start_date || !b.due_date) {
    return NextResponse.json({ error: "Missing booking details" }, { status: 400 });
  }
  if (!b.success_url || !b.cancel_url) {
    return NextResponse.json({ error: "Missing redirect URLs" }, { status: 400 });
  }

  const items = await sql`
    SELECT id, COALESCE(NULLIF(name, ''), brand) AS brand, rental_price, status
    FROM items WHERE id = ${b.item_id}
  `;
  if (items.length === 0) {
    return NextResponse.json({ error: "Piece not found" }, { status: 404 });
  }
  const item = items[0];
  if (item.status === "retired" || item.status === "with_consignor") {
    return NextResponse.json({ error: "This piece isn't available" }, { status: 400 });
  }

  // Block if already booked for those dates (avoids charging for a clash).
  const conflicts = await sql`
    SELECT id FROM rentals
    WHERE item_id = ${b.item_id} AND status IN ('reserved','active')
      AND start_date <= ${b.due_date} AND due_date >= ${b.start_date}
  `;
  if (conflicts.length > 0) {
    return NextResponse.json(
      { error: "This piece is already booked for those dates" },
      { status: 409 }
    );
  }

  const customerId = await findOrCreateCustomer({
    name: b.customer.name,
    phone: b.customer.phone,
    email: b.customer.email,
  });

  // Reuse/create the Stripe Customer so the saved card attaches to them —
  // resilient to a stale id (verifies it exists in the current mode, else makes
  // a fresh one) so "No such customer" can never break the reservation.
  const stripeCustomerId = await ensureStripeCustomer(stripe, customerId);
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "Couldn't set up payment" }, { status: 500 });
  }

  const cleaningFee = (await getProgram()).cleaning_fee;
  const rentalCents = Math.round(Number(item.rental_price) * 100);
  const feeCents = Math.round(cleaningFee * 100);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    payment_intent_data: { setup_future_usage: "off_session" },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: rentalCents,
          product_data: { name: `${item.brand} — rental` },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: feeCents,
          product_data: { name: "Cleaning & Care Fee" },
        },
      },
    ],
    metadata: {
      item_id: String(b.item_id),
      start_date: String(b.start_date),
      due_date: String(b.due_date),
      customer_id: String(customerId),
    },
    success_url: b.success_url,
    cancel_url: b.cancel_url,
  });

  return NextResponse.json({ url: session.url });
}
