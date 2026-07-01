import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe, ensureStripeCustomer } from "@/lib/stripe";
import { resolveReader } from "@/lib/terminal";

/**
 * Starts an in-person charge for a checkout transaction on the Terminal reader.
 * Server-driven: creates a card_present PaymentIntent and tells the reader to
 * collect it (the customer taps). In test mode the tap is simulated so the
 * flow can be exercised without hardware.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const b = await request.json();
  if (!b.transaction_id) {
    return NextResponse.json({ error: "transaction_id is required" }, { status: 400 });
  }

  // Resolve the reader from Stripe live — never trust a stored id (a test-mode
  // id doesn't exist in live mode → "No such reader"). b.reader_id is only a
  // preference, honored only if it's really registered on this account.
  const resolution = await resolveReader(stripe, b.reader_id, b.location || undefined);
  if (!resolution.ok) {
    if (resolution.reason === "none") {
      return NextResponse.json(
        {
          error: "No reader connected in Stripe — check Terminal → Readers.",
          code: "no_reader",
        },
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

  const tx = (
    await sql`SELECT id, total, customer_id, payment_status FROM transactions WHERE id = ${b.transaction_id}`
  )[0];
  if (!tx) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }
  const amount = Math.round(Number(tx.total) * 100);

  // Nothing to charge (e.g. fully covered by credits) — mark paid immediately.
  if (amount <= 0) {
    await markPaid(Number(tx.id), null);
    return NextResponse.json({ payment_intent_id: null, status: "succeeded" });
  }

  // Link (or create) a Stripe customer so the card can be saved for later
  // off-session charges (late fees / damage), same as the online + card-on-file
  // flows. Resilient to stale ids (verifies/recreates in the current mode).
  const stripeCustomerId = (await ensureStripeCustomer(stripe, tx.customer_id)) ?? undefined;

  const pi = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    customer: stripeCustomerId,
    // With a customer attached, save a reusable card generated from the tap so
    // the late-fee / damage engine can charge it off-session later.
    ...(stripeCustomerId ? { setup_future_usage: "off_session" as const } : {}),
    metadata: { transaction_id: String(tx.id) },
  });

  await stripe.terminal.readers.processPaymentIntent(readerId, {
    payment_intent: pi.id,
    // Required by Stripe when the payment saves a card (setup_future_usage).
    // "always" = we may charge this saved card off-session later (late
    // fees / damage). Only sent when there's a customer to save it to.
    ...(stripeCustomerId
      ? { process_config: { allow_redisplay: "always" as const } }
      : {}),
  });

  // Test mode: simulate the customer tapping a card on the simulated reader.
  if ((process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test")) {
    try {
      await stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);
    } catch {
      /* real reader or already presented — ignore */
    }
  }

  return NextResponse.json({ payment_intent_id: pi.id, status: "processing", reader_id: readerId });
}

async function markPaid(transactionId: number, piId: string | null) {
  await sql`
    UPDATE transactions
    SET payment_status = 'collected', payment_method = 'terminal', payment_ref = ${piId}
    WHERE id = ${transactionId}
  `;
  await sql`UPDATE rentals SET paid = true WHERE transaction_id = ${transactionId}`;
}
