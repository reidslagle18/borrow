import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe, ensureStripeCustomer } from "@/lib/stripe";
import { getProgram } from "@/lib/credits";
import { findOrCreateCustomer, reservationCutoffConflict, createBooking } from "@/lib/bookings";
import { activeCampaignForCode } from "@/lib/campaigns";
import { salesTax, closedPickupDate, nextOpenDate } from "@/lib/types";

/**
 * Creates a Stripe Checkout Session so a customer can pay the full amount
 * (rental price, which already includes cleaning, + tax) to reserve a piece. The card is saved
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
  if (
    item.status === "retired" ||
    item.status === "with_consignor" ||
    item.status === "consignor_hold"
  ) {
    return NextResponse.json({ error: "This piece isn't available" }, { status: 400 });
  }
  // A consignment piece can't be paid for until it's approved and its batch is clear.
  const gate = await sql`
    SELECT i.ownership, i.approval_status,
      (SELECT COUNT(*)::int FROM items s
        WHERE s.consignor_id = i.consignor_id
          AND s.approval_status IN ('pending','disputed')) AS pending_siblings
    FROM items i WHERE i.id = ${b.item_id}
  `;
  if (
    gate[0]?.ownership === "consignment" &&
    (gate[0].approval_status !== "approved" || Number(gate[0].pending_siblings) > 0)
  ) {
    return NextResponse.json(
      { error: "This piece isn't available yet — it's awaiting consignor approval." },
      { status: 400 }
    );
  }

  const program = await getProgram();
  // A closed PICKUP day is blocked (nobody's there to hand it over); a closed
  // RETURN day just rolls the due date to the next open day, no penalty.
  const closedPickup = closedPickupDate(
    String(b.start_date),
    program.store_closed_dates,
    program.store_closed_weekdays
  );
  if (closedPickup) {
    return NextResponse.json(
      { error: `The studio is closed on ${closedPickup}, so pickup can't be that day. Please choose a different pickup date.` },
      { status: 409 }
    );
  }
  b.due_date = nextOpenDate(String(b.due_date), program.store_closed_dates, program.store_closed_weekdays);
  // Don't take a payment for a pickup date before reservations open.
  if (
    program.reservations_open &&
    String(b.start_date).slice(0, 10) < program.reservations_open
  ) {
    return NextResponse.json(
      { error: `Reservations open ${program.reservations_open} — please choose a later pickup date.` },
      { status: 400 }
    );
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

  // Last Safe Rental Date guard: don't take payment for a rental that starts too
  // close to a confirmed reservation to be back and cleaned in time.
  const reservedFor = await reservationCutoffConflict(b.item_id, b.start_date, program);
  if (reservedFor) {
    return NextResponse.json(
      {
        error: `Reserved ${reservedFor} — no longer available for new rentals to protect that booking.`,
      },
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

  // The exact stored rental_price is charged as a dynamic, ad-hoc amount (not a
  // fixed tier Price object). It already includes the Cleaning & Care Fee, so
  // no separate fee line is added.
  const rentalCents = Math.round(Number(item.rental_price) * 100);
  const taxCents = Math.round(salesTax(Number(item.rental_price), program.sales_tax_rate) * 100);

  // Apply the customer's store credit toward this order (up to the full amount
  // owed or their full balance, whichever is less). Any remainder is charged to
  // the card; any leftover credit stays on their balance for next time.
  const grossCents = rentalCents + taxCents;
  const balRow = await sql`SELECT store_credit FROM customers WHERE id = ${customerId}`;
  const balanceCents = Math.round(Number(balRow[0]?.store_credit ?? 0) * 100);
  const creditCents = Math.max(0, Math.min(balanceCents, grossCents));
  const chargeCents = grossCents - creditCents;

  // Give-back campaign tag (no discount / no price change). Only tags if the code
  // is a campaign active for today's payment date.
  const campaign = await activeCampaignForCode(b.campaign_code);
  const campaignCode = campaign?.code ?? "";

  // Fully covered (Stripe can't charge < ~$0.50) → book now, no card charge, and
  // redeem the credit. The shop shows the success screen via the "credit" marker.
  if (chargeCents < 50) {
    const result = await createBooking({
      item_id: b.item_id,
      customer_id: customerId,
      start_date: b.start_date,
      due_date: b.due_date,
      rental_price: Number(item.rental_price),
      damage_waiver: true,
      notes: "Reserved — paid with store credit",
      source: "web",
      paid: true,
      stripe_customer_id: stripeCustomerId,
      stripe_payment_method_id: null,
      stripe_session_id: null,
      campaign_code: campaignCode || null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const redeem = creditCents / 100;
    await sql`UPDATE customers SET store_credit = GREATEST(store_credit - ${redeem}, 0) WHERE id = ${customerId}`;
    await sql`
      INSERT INTO store_credit_entries (customer_id, amount, reason, rental_id, note)
      VALUES (${customerId}, ${-redeem}, 'redeem', ${(result.rental as { id: number }).id}, 'Online reservation — store credit')
    `;
    return NextResponse.json({
      url: String(b.success_url).replace("{CHECKOUT_SESSION_ID}", "credit"),
    });
  }

  // Partial credit → a one-time amount_off coupon shows "Store credit −$X" on the
  // Stripe page; the rest is charged. The credit is deducted at fulfillment.
  const discounts =
    creditCents > 0
      ? [
          {
            coupon: (
              await stripe.coupons.create({
                amount_off: creditCents,
                currency: "usd",
                duration: "once",
                name: "Store credit",
                max_redemptions: 1,
              })
            ).id,
          },
        ]
      : undefined;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    // Open on card entry (Apple Pay / Google Pay ride on "card") rather than
    // defaulting to Stripe Link.
    payment_method_types: ["card"],
    payment_intent_data: { setup_future_usage: "off_session" },
    discounts,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: rentalCents,
          product_data: { name: `${item.brand} rental (Cleaning & Care Fee included)` },
        },
      },
      ...(taxCents > 0
        ? [
            {
              quantity: 1,
              price_data: {
                currency: "usd" as const,
                unit_amount: taxCents,
                product_data: { name: "Sales tax" },
              },
            },
          ]
        : []),
    ],
    metadata: {
      item_id: String(b.item_id),
      start_date: String(b.start_date),
      due_date: String(b.due_date),
      customer_id: String(customerId),
      credit_applied: String(creditCents), // cents; redeemed at fulfillment
      campaign_code: campaignCode, // give-back tag; applied at fulfillment
    },
    success_url: b.success_url,
    cancel_url: b.cancel_url,
  });

  return NextResponse.json({ url: session.url });
}
