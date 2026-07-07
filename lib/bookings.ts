import { sql } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { getStripe } from "@/lib/stripe";
import { salesTax } from "@/lib/types";
import { sendBookingConfirmation } from "@/lib/email";
import { fmtShort } from "@/lib/dates";

export interface BookingInput {
  item_id: string;
  customer_id: number | null;
  start_date: string;
  due_date: string;
  rental_price: number;
  damage_waiver: boolean;
  notes: string | null;
  source: "studio" | "web";
  // set when the reservation was paid online via Stripe Checkout
  paid?: boolean;
  stripe_customer_id?: string | null;
  stripe_payment_method_id?: string | null;
  stripe_session_id?: string | null;
}

export type BookingResult =
  | { ok: true; rental: Record<string, unknown> }
  | { ok: false; status: number; error: string; conflicts?: unknown[] };

/**
 * Single entry point for creating a booking — used by both the studio
 * dashboard and the public (customer-site) API so the double-booking
 * guard can never be bypassed.
 */
export async function createBooking(b: BookingInput): Promise<BookingResult> {
  if (!b.item_id || !b.start_date || !b.due_date || b.rental_price == null) {
    return {
      ok: false,
      status: 400,
      error: "item_id, start_date, due_date and rental_price are required",
    };
  }
  if (b.due_date < b.start_date) {
    return {
      ok: false,
      status: 400,
      error: "Due date can't be before the pickup date",
    };
  }

  const item = await sql`SELECT id, status FROM items WHERE id = ${b.item_id}`;
  if (item.length === 0) {
    return { ok: false, status: 404, error: "Piece not found" };
  }
  if (item[0].status === "retired") {
    return { ok: false, status: 400, error: "This piece is retired" };
  }
  if (item[0].status === "with_consignor") {
    return {
      ok: false,
      status: 400,
      error: "This piece is out with its consignor right now",
    };
  }

  // A piece isn't bookable again until turnaround_days after a prior return
  // (cleaning/turnaround buffer), so extend each existing rental's due date by
  // the buffer when checking overlaps.
  const program = await getProgram();
  const buffer = program.turnaround_days;
  const conflicts = await sql`
    SELECT r.id, r.start_date, r.due_date, c.name AS customer_name
    FROM rentals r
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.item_id = ${b.item_id}
      AND r.status IN ('reserved','active')
      AND r.start_date <= ${b.due_date}
      AND (r.due_date + ${buffer}::int) >= ${b.start_date}
  `;
  if (conflicts.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "This piece is already booked (or in its cleaning buffer) for those dates",
      conflicts,
    };
  }

  // The Cleaning & Care Fee is charged when the waiver flag is set; store the
  // actual configured amount so finances reflect it (see app/api/finances).
  const fee = b.damage_waiver ? program.cleaning_fee : 0;
  const tax = salesTax(Number(b.rental_price), program.sales_tax_rate);
  const rows = await sql`
    INSERT INTO rentals (
      item_id, customer_id, start_date, due_date, status,
      rental_price, damage_waiver, cleaning_fee, sales_tax, notes, source,
      paid, stripe_customer_id, stripe_payment_method_id, stripe_session_id
    ) VALUES (
      ${b.item_id}, ${b.customer_id}, ${b.start_date}, ${b.due_date},
      'reserved', ${b.rental_price}, ${b.damage_waiver}, ${fee}, ${tax}, ${b.notes}, ${b.source},
      ${b.paid ?? false}, ${b.stripe_customer_id ?? null},
      ${b.stripe_payment_method_id ?? null}, ${b.stripe_session_id ?? null}
    )
    RETURNING *
  `;

  await sql`
    UPDATE items SET status = 'reserved', updated_at = now()
    WHERE id = ${b.item_id} AND status = 'available'
  `;

  // Instant booking confirmation (best-effort email; needs an email on file).
  if (b.customer_id) {
    const c = await sql`SELECT name, email FROM customers WHERE id = ${b.customer_id}`;
    if (c[0]?.email) {
      const brand =
        (await sql`SELECT COALESCE(NULLIF(name, ''), brand) AS brand FROM items WHERE id = ${b.item_id}`)[0]
          ?.brand ?? "your piece";
      await sendBookingConfirmation({
        to: c[0].email,
        customerName: c[0].name ?? "",
        brand,
        startDate: fmtShort(b.start_date),
        dueDate: fmtShort(b.due_date),
        total: Number(b.rental_price) + fee,
      });
    }
  }

  return { ok: true, rental: rows[0] };
}

/** Find a customer by phone/email or create one. Used by the public booking API. */
export async function findOrCreateCustomer(c: {
  name: string;
  phone?: string | null;
  email?: string | null;
}): Promise<number> {
  const phone = c.phone?.trim() || null;
  const email = c.email?.trim().toLowerCase() || null;

  if (phone || email) {
    const existing = await sql`
      SELECT id FROM customers
      WHERE (${phone}::text IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace(${phone}::text, '\\D', '', 'g'))
         OR (${email}::text IS NOT NULL AND lower(email) = ${email}::text)
      LIMIT 1
    `;
    if (existing.length > 0) return existing[0].id;
  }

  const rows = await sql`
    INSERT INTO customers (name, phone, email)
    VALUES (${c.name.trim()}, ${phone}, ${email})
    RETURNING id
  `;
  return rows[0].id;
}

/**
 * Fulfills a paid Stripe Checkout Session into a reservation. Idempotent (keyed
 * on the session id) so it's safe to call from both the success page and the
 * webhook. If the piece was booked by someone else in the meantime, the payment
 * is refunded rather than leaving the customer charged with no reservation.
 */
export async function fulfillReservation(
  sessionId: string
): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "stripe-not-configured" };

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
  if (session.payment_status !== "paid") return { ok: false, error: "not-paid" };

  const already = await sql`SELECT id FROM rentals WHERE stripe_session_id = ${sessionId}`;
  if (already.length > 0) return { ok: true, already: true };

  const m = (session.metadata || {}) as Record<string, string>;
  const itemId = m.item_id;
  const customerId = m.customer_id ? Number(m.customer_id) : null;
  const pi = session.payment_intent;
  const paymentMethodId =
    pi && typeof pi === "object" && typeof pi.payment_method === "string"
      ? pi.payment_method
      : null;
  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  const item = await sql`SELECT rental_price FROM items WHERE id = ${itemId}`;
  if (item.length === 0) return { ok: false, error: "item-missing" };

  const result = await createBooking({
    item_id: itemId,
    customer_id: customerId,
    start_date: m.start_date,
    due_date: m.due_date,
    rental_price: Number(item[0].rental_price),
    damage_waiver: true,
    notes: "Reserved + paid online",
    source: "web",
    paid: true,
    stripe_customer_id: stripeCustomerId,
    stripe_payment_method_id: paymentMethodId,
    stripe_session_id: sessionId,
  });

  if (!result.ok) {
    // Couldn't reserve (e.g. just got booked) — refund so they're not charged.
    if (pi && typeof pi === "object") {
      try {
        await stripe.refunds.create({ payment_intent: pi.id });
      } catch {
        /* surface via follow-up if refund fails */
      }
    }
    return { ok: false, error: result.error };
  }

  if (customerId && stripeCustomerId) {
    await sql`UPDATE customers SET stripe_customer_id = ${stripeCustomerId} WHERE id = ${customerId} AND stripe_customer_id IS NULL`;
  }
  return { ok: true };
}
