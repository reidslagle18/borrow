import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Discard a not-yet-paid checkout (e.g. the customer walked away, or an
 * in-person tap was canceled). Reverses the order so nothing is left stranded:
 * cancels its rentals, frees the pieces (status + rental_count), refunds any
 * store credit applied, drops referral rows, and voids the transaction.
 *
 * Refuses to touch an already-collected transaction.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  if (!b.transaction_id) {
    return NextResponse.json({ error: "transaction_id is required" }, { status: 400 });
  }

  const tx = (
    await sql`SELECT id, customer_id, payment_status, store_credit_applied FROM transactions WHERE id = ${b.transaction_id}`
  )[0];
  if (!tx) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }
  if (tx.payment_status === "collected") {
    return NextResponse.json(
      { error: "This order is already paid and can't be discarded." },
      { status: 400 }
    );
  }
  if (tx.payment_status === "void") {
    return NextResponse.json({ ok: true }); // already discarded — idempotent
  }

  // Free each piece: undo the rental_count bump and re-derive its status from
  // any remaining live rentals, then cancel this order's rentals.
  const rentals = await sql`
    SELECT id, item_id FROM rentals WHERE transaction_id = ${tx.id} AND status <> 'completed'
  `;
  for (const r of rentals) {
    await sql`
      UPDATE items SET rental_count = GREATEST(rental_count - 1, 0), updated_at = now()
      WHERE id = ${r.item_id}
    `;
  }
  await sql`
    UPDATE rentals SET status = 'cancelled', updated_at = now()
    WHERE transaction_id = ${tx.id} AND status <> 'completed'
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

  // Refund any store credit that was applied to this order.
  const credit = Number(tx.store_credit_applied || 0);
  if (credit > 0 && tx.customer_id) {
    await sql`UPDATE customers SET store_credit = store_credit + ${credit} WHERE id = ${tx.customer_id}`;
    await sql`
      INSERT INTO store_credit_entries (customer_id, amount, reason, transaction_id)
      VALUES (${tx.customer_id}, ${credit}, 'void_refund', ${tx.id})
    `;
  }

  // Drop referral attribution tied to this order (tracking only).
  await sql`DELETE FROM ambassador_referrals WHERE transaction_id = ${tx.id}`;

  await sql`UPDATE transactions SET payment_status = 'void' WHERE id = ${tx.id}`;
  return NextResponse.json({ ok: true });
}
