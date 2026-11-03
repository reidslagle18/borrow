import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Unified Orders feed — EVERY order, however it was placed:
 *   • In-store (Stripe Terminal / S700): one `transactions` row + its rentals.
 *   • Online (borrow-shop reservation): rentals with source='web', grouped by
 *     their Stripe Checkout Session; no transactions row.
 *   • Studio-created reservations with no POS transaction: the rental itself.
 *
 * `rentals` is the shared source of truth for all three, so this reads orders
 * from it (plus the transactions row for in-store payment detail). Newest first.
 * Optional ?source=online|in_store filters; ?limit caps the list. ITEM shape and
 * photos match the earlier Orders enhancement so the list looks identical
 * regardless of source.
 */

type RawOrder = {
  order_key: string;
  display_id: number;
  source: string;
  transaction_id: number | null;
  customer_id: number | null;
  customer_name: string | null;
  piece_count: number;
  total: string | number;
  store_credit_applied: string | number;
  payment_method: string;
  payment_status: string;
  payment_ref: string | null;
  campaign_code: string | null;
  refund_amount: string | number;
  refunded_at: string | null;
  created_at: string;
  start_date: string;
  due_date: string;
  items: { item_id: string; title: string; brand: string; photo_url: string | null }[];
  statuses: string[];
};

// Lifecycle status for the whole order, from its rentals' statuses.
function orderStatus(statuses: string[]): string {
  if (statuses.includes("active")) return "active";
  if (statuses.includes("reserved")) return "reserved";
  if (statuses.includes("completed")) return "completed";
  return "cancelled";
}

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const source = url.searchParams.get("source"); // 'online' | 'in_store' | null
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit")) || 200)
  );

  // (A) In-store POS orders — one per transactions row.
  const inStore = (await sql`
    SELECT
      'txn:' || t.id::text AS order_key,
      t.id AS display_id,
      t.id AS transaction_id,
      'in_store' AS source,
      t.customer_id, c.name AS customer_name,
      t.piece_count, t.total, t.store_credit_applied,
      t.payment_method, t.payment_status, t.payment_ref,
      (SELECT MAX(r.campaign_code) FROM rentals r WHERE r.transaction_id = t.id) AS campaign_code,
      t.refund_amount, t.refunded_at, t.created_at,
      to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
      to_char(t.due_date, 'YYYY-MM-DD') AS due_date,
      COALESCE((SELECT json_agg(json_build_object(
                  'item_id', i.id, 'barcode', i.barcode,
                  'title', COALESCE(NULLIF(i.name, ''), i.brand),
                  'brand', i.brand, 'description', i.description, 'photo_url', i.photo_url
                ) ORDER BY i.brand)
                  FROM rentals r JOIN items i ON i.id = r.item_id
                 WHERE r.transaction_id = t.id), '[]') AS items,
      COALESCE((SELECT json_agg(r.status)
                  FROM rentals r WHERE r.transaction_id = t.id), '[]') AS statuses
    FROM transactions t
    LEFT JOIN customers c ON c.id = t.customer_id
  `) as unknown as RawOrder[];

  // (B) Online + any studio reservation with no POS transaction — grouped by the
  // checkout session (online) or the individual rental (standalone).
  const others = (await sql`
    SELECT
      COALESCE(r.stripe_session_id, 'r' || r.id::text) AS order_key,
      MIN(r.id)::int AS display_id,
      NULL::int AS transaction_id,
      (CASE WHEN bool_or(r.source = 'web') THEN 'online' ELSE 'in_store' END) AS source,
      MAX(r.customer_id) AS customer_id,
      MAX(c.name) AS customer_name,
      COUNT(*)::int AS piece_count,
      SUM(r.rental_price + COALESCE(r.sales_tax, 0))::numeric(10,2) AS total,
      0 AS store_credit_applied,
      (CASE WHEN bool_or(r.source = 'web') THEN 'online' ELSE 'reservation' END) AS payment_method,
      (CASE WHEN bool_or(r.paid) THEN 'collected' ELSE 'pending' END) AS payment_status,
      MAX(r.campaign_code) AS campaign_code,
      NULL AS payment_ref,
      0 AS refund_amount,
      NULL AS refunded_at,
      MIN(r.created_at) AS created_at,
      to_char(MIN(r.start_date), 'YYYY-MM-DD') AS start_date,
      to_char(MAX(r.due_date), 'YYYY-MM-DD') AS due_date,
      json_agg(json_build_object(
        'item_id', i.id, 'barcode', i.barcode,
        'title', COALESCE(NULLIF(i.name, ''), i.brand),
        'brand', i.brand, 'description', i.description, 'photo_url', i.photo_url
      ) ORDER BY i.brand) AS items,
      json_agg(r.status) AS statuses
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.transaction_id IS NULL
    GROUP BY COALESCE(r.stripe_session_id, 'r' || r.id::text)
  `) as unknown as RawOrder[];

  const merged = [...inStore, ...others]
    .map((o) => {
      const status = orderStatus(Array.isArray(o.statuses) ? o.statuses : []);
      return {
        ...o,
        order_status: status,
        // Only an in-store card charge (a Stripe PaymentIntent, not yet refunded)
        // can be refunded in-app here. Online reservations are refunded through
        // the cancellation flow on the calendar.
        refundable:
          o.transaction_id != null &&
          o.payment_status === "collected" &&
          typeof o.payment_ref === "string" &&
          o.payment_ref.startsWith("pi_"),
      };
    })
    .filter((o) =>
      source === "online" || source === "in_store" ? o.source === source : true
    )
    .sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, limit);

  return NextResponse.json({ orders: merged });
}
