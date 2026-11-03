import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { fmtWeekday } from "@/lib/dates";
import {
  sendPieceCancellationUpdate,
  sendConsignorRentalCancelled,
} from "@/lib/email";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY): cancel ONE piece out of a
 * multi-piece order, keeping the rest. Refunds only that piece's rental price
 * (NOT its share of any extra-days fee, and not tax — same 48h+ policy as the
 * studio cancel), frees the piece, emails the customer an updated reservation,
 * and — only if the consignor was already told the piece rented (i.e. it had
 * been picked up) — emails them that the rental was cancelled.
 *
 * Body: { rental_id: number, dry_run?: boolean }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const rentalId = Number(b.rental_id);
  const dryRun = b.dry_run === true;
  if (!rentalId) {
    return NextResponse.json({ error: "rental_id required" }, { status: 400 });
  }

  const rows = await sql`
    SELECT r.*, to_char(r.start_date, 'YYYY-MM-DD') AS start_iso,
           to_char(r.due_date, 'YYYY-MM-DD') AS due_iso,
           cu.name AS customer_name, cu.email AS customer_email,
           COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
           i.ownership, i.consignor_id
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers cu ON cu.id = r.customer_id
    WHERE r.id = ${rentalId}
  `;
  const rental = rows[0];
  if (!rental) {
    return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  }
  if (rental.status === "completed" || rental.status === "cancelled") {
    return NextResponse.json(
      { error: `Rental is already ${rental.status}.` },
      { status: 400 }
    );
  }

  const rentalPrice = Math.round(Number(rental.rental_price) * 100) / 100;
  const wasPickedUp = rental.status === "active";
  const hoursUntilPickup =
    (Date.parse(`${rental.start_iso}T12:00:00Z`) - Date.now()) / 3_600_000;
  const refundEligible =
    rental.paid === true && !wasPickedUp && hoursUntilPickup >= 48;

  // Remaining live pieces in the same order (for the customer's updated summary).
  const remaining = rental.transaction_id
    ? await sql`
        SELECT COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.size
        FROM rentals r JOIN items i ON i.id = r.item_id
        WHERE r.transaction_id = ${rental.transaction_id}
          AND r.id <> ${rentalId}
          AND r.status IN ('reserved', 'active')
        ORDER BY r.id
      `
    : [];

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      rental_id: rentalId,
      piece: rental.brand,
      would_refund: refundEligible ? rentalPrice : 0,
      customer: rental.customer_name,
      customer_email: rental.customer_email,
      remaining_pieces: remaining.map((r) => r.brand),
      consignor_email_will_send: wasPickedUp && rental.ownership === "consignment",
    });
  }

  // 1) Refund the piece's rental price only (partial refund on the shared PI).
  let refunded = 0;
  let refundError: string | null = null;
  if (refundEligible) {
    const stripe = getStripe();
    let piId: string | null = null;
    if (rental.stripe_session_id && stripe) {
      const session = await stripe.checkout.sessions.retrieve(
        rental.stripe_session_id as string,
        { expand: ["payment_intent"] }
      );
      const pi = session.payment_intent;
      piId = typeof pi === "string" ? pi : pi?.id ?? null;
    } else if (rental.transaction_id) {
      const tx = (
        await sql`SELECT payment_ref FROM transactions WHERE id = ${rental.transaction_id}`
      )[0];
      const ref = tx?.payment_ref;
      if (typeof ref === "string" && ref.startsWith("pi_")) piId = ref;
    }
    if (stripe && piId && rentalPrice > 0) {
      try {
        await stripe.refunds.create(
          { payment_intent: piId, amount: Math.round(rentalPrice * 100) },
          { idempotencyKey: `cancel_refund_${rentalId}` }
        );
        refunded = rentalPrice;
        if (rental.transaction_id) {
          await sql`
            UPDATE transactions
            SET refund_amount = COALESCE(refund_amount, 0) + ${rentalPrice},
                refunded_at = COALESCE(refunded_at, now())
            WHERE id = ${rental.transaction_id}
          `.catch(() => {});
        }
      } catch (err) {
        refundError = (err as Error).message;
      }
    } else {
      refundError = "no-payment-intent";
    }
  }

  // 2) Cancel the rental + free the piece.
  await sql`UPDATE rentals SET status = 'cancelled', updated_at = now() WHERE id = ${rentalId}`;
  await sql`
    UPDATE items SET status = CASE
      WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${rental.item_id} AND status = 'active') THEN 'rented'
      WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${rental.item_id} AND status = 'reserved') THEN 'reserved'
      ELSE 'available'
    END, updated_at = now()
    WHERE id = ${rental.item_id} AND status IN ('available','reserved','rented')
  `;

  // 3) Email the customer the updated reservation.
  let customerEmailed = false;
  if (rental.customer_email) {
    const res = await sendPieceCancellationUpdate({
      to: rental.customer_email as string,
      customerName: (rental.customer_name as string) ?? "",
      cancelledBrand: rental.brand as string,
      refundAmount: refunded,
      remaining: remaining.map((r) => ({ brand: r.brand as string, size: r.size as string })),
      pickupLabel: fmtWeekday(rental.start_iso as string),
      returnLabel: fmtWeekday(rental.due_iso as string),
    });
    customerEmailed = res.sent;
  }

  // 4) Consignor email ONLY if they were already told it rented. That's true
  //    when the piece was picked up (reservations hold the email until pickup),
  //    OR when it's an e.closet order (that email fires when the order is logged).
  const consignorWasNotified = wasPickedUp || rental.source === "ecloset";
  let consignorEmailed = false;
  let consignorSkippedReason: string | null = null;
  if (rental.ownership === "consignment" && rental.consignor_id) {
    if (consignorWasNotified) {
      const c = (
        await sql`SELECT name, email FROM consignors WHERE id = ${rental.consignor_id}`
      )[0];
      if (c?.email) {
        const res = await sendConsignorRentalCancelled({
          to: c.email as string,
          consignorName: (c.name as string) ?? "",
          brand: rental.brand as string,
        });
        consignorEmailed = res.sent;
      }
    } else {
      consignorSkippedReason = "never-picked-up-so-consignor-was-not-told-it-rented";
    }
  }

  return NextResponse.json({
    ok: true,
    rental_id: rentalId,
    piece: rental.brand,
    refunded,
    refund_error: refundError,
    customer_emailed: customerEmailed,
    consignor_emailed: consignorEmailed,
    consignor_skipped: consignorSkippedReason,
    remaining_pieces: remaining.map((r) => r.brand),
  });
}
