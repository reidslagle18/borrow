import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { sendReplacementPaymentLink } from "@/lib/email";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY). Emails a renter a FRESH secure
 * Stripe Checkout link to pay an uncollected charge whose card-on-file declined
 * off-session (e.g. a replacement value). Creates a new checkout session each
 * call so the link is always valid, refreshes rental.payment_link_url, and sends
 * the email.
 *
 * Body: { rental_id, amount, brand?, reason?, kind? }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const rentalId = Number(b.rental_id);
  const amount = Math.round(Number(b.amount) * 100) / 100;
  const kind = typeof b.kind === "string" ? b.kind : "replacement";
  const reason =
    typeof b.reason === "string" && b.reason.trim()
      ? b.reason.trim()
      : "it couldn't be returned to rentable condition";
  if (!rentalId || !(amount > 0)) {
    return NextResponse.json({ error: "rental_id and a positive amount are required" }, { status: 400 });
  }

  const r = (
    await sql`
      SELECT r.id, r.stripe_customer_id,
             c.name AS customer_name, c.email AS customer_email,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.id = ${rentalId}
    `
  )[0];
  if (!r) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  if (!r.customer_email) {
    return NextResponse.json({ error: "No email on file for this renter." }, { status: 400 });
  }

  const brand = typeof b.brand === "string" && b.brand.trim() ? b.brand.trim() : String(r.brand);
  const description = `Replacement value — ${brand}`;

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });

  let url: string | null = null;
  try {
    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: r.stripe_customer_id || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amount * 100),
            product_data: { name: description },
          },
        },
      ],
      metadata: { rental_id: String(rentalId), kind },
      success_url: `${origin}/returns?paid=1`,
      cancel_url: `${origin}/returns`,
    });
    url = session.url;
  } catch (err) {
    return NextResponse.json({ error: `Couldn't create payment link: ${(err as Error).message}` }, { status: 502 });
  }
  if (!url) return NextResponse.json({ error: "Stripe returned no link." }, { status: 502 });

  // Refresh the link on the rental so any follow-up uses the valid one.
  await sql`UPDATE rentals SET payment_link_url = ${url} WHERE id = ${rentalId}`;

  const sent = await sendReplacementPaymentLink({
    to: String(r.customer_email),
    name: String(r.customer_name || ""),
    brand,
    amount,
    url,
    reason,
  });
  if (!sent.sent) {
    return NextResponse.json({ error: "Link created but the email failed to send.", url }, { status: 502 });
  }
  return NextResponse.json({ ok: true, sent: true, to: r.customer_email, amount, url });
}
