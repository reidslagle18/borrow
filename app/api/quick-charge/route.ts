import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { resolveReader } from "@/lib/terminal";

/** Recent Quick Charges for the running log. */
export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT q.id, q.amount, q.note, q.status, q.person_name, q.person_phone,
           q.created_at, c.name AS customer_name
    FROM quick_charges q
    LEFT JOIN customers c ON c.id = q.customer_id
    ORDER BY q.created_at DESC, q.id DESC
    LIMIT 100
  `;
  return NextResponse.json({ charges: rows });
}

/**
 * Start a standalone Quick Charge on the Terminal reader. Not tied to any piece,
 * order, or consignor ledger. Creates the record (pending), a card_present
 * PaymentIntent, and tells the reader to collect. The screen then polls
 * /api/stripe/terminal/poll and finalizes via PATCH here.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));

  const amount = Math.round(Number(b.amount) * 100);
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Enter a positive amount." }, { status: 400 });
  }

  const resolution = await resolveReader(stripe, b.reader_id, b.location || undefined);
  if (!resolution.ok) {
    if (resolution.reason === "none") {
      return NextResponse.json(
        { error: "No reader connected in Stripe — check Terminal → Readers.", code: "no_reader" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "More than one reader is registered — pick which one to use.",
        code: "multiple_readers",
        readers: resolution.readers,
      },
      { status: 409 }
    );
  }
  const readerId = resolution.reader_id;

  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  const customerId =
    b.customer_id != null && b.customer_id !== "" ? Number(b.customer_id) : null;
  const personName =
    typeof b.person_name === "string" && b.person_name.trim() ? b.person_name.trim() : null;
  const personPhone =
    typeof b.person_phone === "string" && b.person_phone.trim() ? b.person_phone.trim() : null;

  const inserted = await sql`
    INSERT INTO quick_charges (amount, note, customer_id, person_name, person_phone, status)
    VALUES (${amount / 100}, ${note}, ${customerId}, ${personName}, ${personPhone}, 'pending')
    RETURNING id
  `;
  const id = Number(inserted[0].id);

  const pi = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    description: note || "Quick charge",
    metadata: { quick_charge_id: String(id) },
  });
  await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: pi.id });
  await sql`UPDATE quick_charges SET stripe_payment_intent_id = ${pi.id} WHERE id = ${id}`;

  // Test mode: simulate the tap so the flow works without hardware.
  if ((process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test")) {
    try {
      await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);
    } catch {
      /* real reader or already presented */
    }
  }

  return NextResponse.json({ id, payment_intent_id: pi.id, reader_id: readerId });
}

/** Finalize a Quick Charge's status after the tap resolves. */
export async function PATCH(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  const status = String(b.status);
  if (!id || !["succeeded", "failed", "canceled"].includes(status)) {
    return NextResponse.json({ error: "id and a valid status are required." }, { status: 400 });
  }
  await sql`
    UPDATE quick_charges
    SET status = ${status},
        stripe_payment_intent_id = COALESCE(${b.payment_intent_id ?? null}, stripe_payment_intent_id)
    WHERE id = ${id} AND status = 'pending'
  `;
  return NextResponse.json({ ok: true });
}
