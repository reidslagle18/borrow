import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { sendOrderCancellation, sendConsignorRentalCancelled } from "@/lib/email";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY): cancel a WHOLE order — every
 * live (reserved/active) rental sharing a transaction, OR a single rental by id
 * (for online orders, which have no transaction) — and refund the rental prices
 * of the eligible ones (48h+ before pickup, not yet picked up; tax and extra-days
 * are not refunded). Refunds each rental against its own payment source (online
 * checkout session, or the in-store transaction's PaymentIntent). Frees each
 * piece, emails the customer ONE cancellation confirmation, and emails any
 * consignor already told their piece rented (picked up, or e.closet).
 *
 * Body: { transaction_id?: number, rental_id?: number, dry_run?: boolean, full?: boolean }
 *
 * `full: true` is an owner override: refund the ENTIRE payment (the whole
 * PaymentIntent — rental price + tax + fees), ignoring the 48h cancellation
 * policy. Intended for a clean "changed her mind" cancel. Online orders are one
 * session/PI per piece, so this refunds exactly that piece's payment; don't use
 * `full` to cancel ONE piece of a multi-piece in-store transaction (that PI
 * covers the whole order) — use the per-transaction refund for those.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const txnId = Number(b.transaction_id) || null;
  const rentalId = Number(b.rental_id) || null;
  const dryRun = b.dry_run === true;
  const full = b.full === true;
  if (!txnId && !rentalId) {
    return NextResponse.json({ error: "transaction_id or rental_id required" }, { status: 400 });
  }

  const rentals = txnId
    ? await sql`
        SELECT r.id, r.status, r.source, r.rental_price, r.paid, r.transaction_id,
               r.stripe_session_id,
               to_char(r.start_date, 'YYYY-MM-DD') AS start_iso,
               r.item_id, cu.name AS customer_name, cu.email AS customer_email,
               COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
               i.ownership, i.consignor_id
        FROM rentals r
        JOIN items i ON i.id = r.item_id
        LEFT JOIN customers cu ON cu.id = r.customer_id
        WHERE r.transaction_id = ${txnId} AND r.status IN ('reserved', 'active')
        ORDER BY r.id
      `
    : await sql`
        SELECT r.id, r.status, r.source, r.rental_price, r.paid, r.transaction_id,
               r.stripe_session_id,
               to_char(r.start_date, 'YYYY-MM-DD') AS start_iso,
               r.item_id, cu.name AS customer_name, cu.email AS customer_email,
               COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
               i.ownership, i.consignor_id
        FROM rentals r
        JOIN items i ON i.id = r.item_id
        LEFT JOIN customers cu ON cu.id = r.customer_id
        WHERE r.id = ${rentalId} AND r.status IN ('reserved', 'active')
        ORDER BY r.id
      `;
  if (rentals.length === 0) {
    return NextResponse.json({ error: "No live rentals on that order" }, { status: 404 });
  }

  const stripe = getStripe();
  // Resolve a rental's PaymentIntent id: online = its checkout session; in-store
  // = its transaction's payment_ref.
  async function piFor(r: { stripe_session_id: string | null; transaction_id: number | null }) {
    if (r.stripe_session_id && stripe) {
      const s = await stripe.checkout.sessions.retrieve(r.stripe_session_id, { expand: ["payment_intent"] });
      const pi = s.payment_intent;
      return typeof pi === "string" ? pi : pi?.id ?? null;
    }
    if (r.transaction_id) {
      const tx = (await sql`SELECT payment_ref FROM transactions WHERE id = ${r.transaction_id}`)[0];
      const ref = tx?.payment_ref;
      return typeof ref === "string" && ref.startsWith("pi_") ? ref : null;
    }
    return null;
  }

  const eligible = (r: { paid: boolean; status: string; start_iso: string }) =>
    r.paid === true &&
    r.status !== "active" &&
    (Date.parse(`${r.start_iso}T12:00:00Z`) - Date.now()) / 3_600_000 >= 48;

  const refundTotal =
    Math.round(
      rentals.filter(eligible).reduce((s, r) => s + Number(r.rental_price), 0) * 100
    ) / 100;

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      transaction_id: txnId,
      rental_id: rentalId,
      full,
      pieces: rentals.map((r) => r.brand),
      would_refund: full ? "full payment (incl. tax)" : refundTotal,
      customer: rentals[0].customer_name,
      customer_email: rentals[0].customer_email,
    });
  }

  // 1) Refund.
  let refunded = 0;
  let refundError: string | null = null;
  if (full) {
    // Owner override — refund the ENTIRE payment, policy aside. One full refund
    // per distinct PaymentIntent (so a multi-piece order isn't refunded twice).
    const seenPI = new Set<string>();
    for (const r of rentals) {
      if (r.paid !== true || !stripe) continue;
      const pi = await piFor(r);
      if (!pi) {
        refundError = "no-payment-intent";
        continue;
      }
      if (seenPI.has(pi)) continue;
      seenPI.add(pi);
      try {
        const refund = await stripe.refunds.create(
          { payment_intent: pi },
          { idempotencyKey: `cancel_order_fullrefund_${pi}` }
        );
        refunded = Math.round((refunded + (refund.amount || 0) / 100) * 100) / 100;
        if (r.transaction_id) {
          await sql`
            UPDATE transactions
            SET refund_amount = COALESCE(refund_amount, 0) + ${(refund.amount || 0) / 100},
                refunded_at = COALESCE(refunded_at, now()),
                payment_status = 'refunded'
            WHERE id = ${r.transaction_id}
          `.catch(() => {});
        }
      } catch (err) {
        refundError = (err as Error).message;
      }
    }
  } else {
    // Policy refund: each eligible rental's price against its own payment source.
    for (const r of rentals) {
      if (!eligible(r)) continue;
      const amt = Math.round(Number(r.rental_price) * 100) / 100;
      if (amt <= 0 || !stripe) continue;
      const pi = await piFor(r);
      if (!pi) {
        refundError = "no-payment-intent";
        continue;
      }
      try {
        await stripe.refunds.create(
          { payment_intent: pi, amount: Math.round(amt * 100) },
          { idempotencyKey: `cancel_order_refund_${r.id}` }
        );
        refunded = Math.round((refunded + amt) * 100) / 100;
        if (r.transaction_id) {
          await sql`
            UPDATE transactions
            SET refund_amount = COALESCE(refund_amount, 0) + ${amt},
                refunded_at = COALESCE(refunded_at, now())
            WHERE id = ${r.transaction_id}
          `.catch(() => {});
        }
      } catch (err) {
        refundError = (err as Error).message;
      }
    }
  }

  // 2) Cancel every rental + free its piece.
  const consignorEmails: string[] = [];
  for (const r of rentals) {
    await sql`UPDATE rentals SET status = 'cancelled', updated_at = now() WHERE id = ${r.id}`;
    await sql`
      UPDATE items SET status = CASE
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${r.item_id} AND status = 'active') THEN 'rented'
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${r.item_id} AND status = 'reserved') THEN 'reserved'
        ELSE 'available'
      END, updated_at = now()
      WHERE id = ${r.item_id} AND status IN ('available','reserved','rented')
    `;
    // Consignor was told it rented only if picked up or it was an e.closet order.
    if (
      r.ownership === "consignment" &&
      r.consignor_id &&
      (r.status === "active" || r.source === "ecloset")
    ) {
      const c = (
        await sql`SELECT name, email FROM consignors WHERE id = ${r.consignor_id}`
      )[0];
      if (c?.email) {
        const res = await sendConsignorRentalCancelled({
          to: c.email as string,
          consignorName: (c.name as string) ?? "",
          brand: r.brand as string,
        });
        if (res.sent) consignorEmails.push(c.email as string);
      }
    }
  }

  // 3) One cancellation email to the customer.
  let customerEmailed = false;
  if (rentals[0].customer_email) {
    const res = await sendOrderCancellation({
      to: rentals[0].customer_email as string,
      customerName: (rentals[0].customer_name as string) ?? "",
      pieces: rentals.map((r) => r.brand as string),
      refundAmount: refunded,
    });
    customerEmailed = res.sent;
  }

  return NextResponse.json({
    ok: true,
    transaction_id: txnId,
    cancelled: rentals.length,
    pieces: rentals.map((r) => r.brand),
    refunded,
    refund_error: refundError,
    customer_emailed: customerEmailed,
    consignors_emailed: consignorEmails.length,
  });
}
