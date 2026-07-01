import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Full refund of an in-person checkout: refunds the Stripe PaymentIntent, marks
 * the transaction refunded, and frees any of its pieces that are still out
 * (cancels their live rentals) so inventory + books stay consistent. Completed
 * (already returned) rentals are left as history.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const { id } = await ctx.params;

  const tx = (
    await sql`SELECT id, total, payment_status, payment_ref, customer_id FROM transactions WHERE id = ${id}`
  )[0];
  if (!tx) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (tx.payment_status === "refunded") {
    return NextResponse.json({ ok: true, already: true }); // idempotent
  }
  if (tx.payment_status !== "collected") {
    return NextResponse.json(
      { error: "Only a paid order can be refunded." },
      { status: 400 }
    );
  }
  if (typeof tx.payment_ref !== "string" || !tx.payment_ref.startsWith("pi_")) {
    return NextResponse.json(
      { error: "No card charge on file to refund (this looks like a cash/manual order)." },
      { status: 400 }
    );
  }

  let refundId: string;
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: tx.payment_ref },
      { idempotencyKey: `refund_tx_${tx.id}` }
    );
    refundId = refund.id;
  } catch (err) {
    return NextResponse.json(
      { error: `Stripe couldn't refund this: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  await sql`
    UPDATE transactions
    SET payment_status = 'refunded', refund_amount = ${tx.total},
        refunded_at = now(), stripe_refund_id = ${refundId}
    WHERE id = ${tx.id}
  `;

  // Free pieces that are still out on this order (leave completed ones as-is).
  const rentals = await sql`
    SELECT id, item_id FROM rentals
    WHERE transaction_id = ${tx.id} AND status IN ('reserved','active')
  `;
  for (const r of rentals) {
    await sql`
      UPDATE items SET rental_count = GREATEST(rental_count - 1, 0), updated_at = now()
      WHERE id = ${r.item_id}
    `;
  }
  await sql`
    UPDATE rentals SET status = 'cancelled', updated_at = now()
    WHERE transaction_id = ${tx.id} AND status IN ('reserved','active')
  `;
  for (const r of rentals) {
    await sql`
      UPDATE items SET status = CASE
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${r.item_id} AND status = 'active') THEN 'rented'
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${r.item_id} AND status = 'reserved') THEN 'reserved'
        ELSE 'available'
      END, updated_at = now()
      WHERE id = ${r.item_id} AND status IN ('available','reserved','rented')
    `;
  }

  return NextResponse.json({ ok: true, refund_id: refundId, amount: Number(tx.total) });
}
