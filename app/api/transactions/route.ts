import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/** Recent in-person checkout orders, newest first, for the Orders page. */
export async function GET(request: Request) {
  await ensureSchema();
  const limit = Math.min(
    200,
    Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 100)
  );

  const rows = await sql`
    SELECT t.id, t.customer_id, c.name AS customer_name,
           t.piece_count, t.subtotal, t.waiver_total, t.total, t.store_credit_applied,
           t.payment_method, t.payment_status, t.payment_ref,
           t.refund_amount, t.refunded_at, t.created_at,
           COALESCE(
             (SELECT string_agg(COALESCE(NULLIF(i.name, ''), i.brand), ', ' ORDER BY i.brand)
                FROM rentals r JOIN items i ON i.id = r.item_id
               WHERE r.transaction_id = t.id),
             ''
           ) AS pieces
    FROM transactions t
    LEFT JOIN customers c ON c.id = t.customer_id
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${limit}
  `;

  // A card charge we can refund in-app = collected via Stripe (payment_ref is a
  // PaymentIntent) and not already refunded.
  const orders = rows.map((t) => ({
    ...t,
    refundable:
      t.payment_status === "collected" &&
      typeof t.payment_ref === "string" &&
      t.payment_ref.startsWith("pi_"),
  }));

  return NextResponse.json({ orders });
}
