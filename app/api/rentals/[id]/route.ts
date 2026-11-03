import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin, getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  sendConsignorRentedEmail,
  sendBookingConfirmation,
  sendConsignorNoShowNotice,
} from "@/lib/email";
import { consignorShare, openDaysLate } from "@/lib/types";
import { fmtShort } from "@/lib/dates";
import { payoutForCompletedRental, createConsignorLossPayout } from "@/lib/connect";
import { chargeRenterForRental, refundLateFeesForRental } from "@/lib/charges";
import { getProgram } from "@/lib/credits";
import { getStripe } from "@/lib/stripe";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Refund a reservation's original card charge (the online Checkout Session's
 * PaymentIntent). Best-effort; returns whether the refund was issued.
 */
/**
 * Refund the RENTAL PRICE ONLY (the Cleaning & Care Fee and tax are
 * non-refundable) for a cancelled reservation. Finds the card charge from the
 * online checkout session, or — for in-store/terminal orders — the PaymentIntent
 * stored on the rental's transaction. Partial refund, idempotent per rental.
 */
async function refundRentalPrice(rental: {
  id: number;
  rental_price: number | string;
  stripe_session_id: string | null;
  transaction_id: number | null;
}): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  const amountCents = Math.round(Number(rental.rental_price) * 100);
  if (amountCents <= 0) return false;
  try {
    let piId: string | null = null;
    if (rental.stripe_session_id) {
      const session = await stripe.checkout.sessions.retrieve(rental.stripe_session_id, {
        expand: ["payment_intent"],
      });
      const pi = session.payment_intent;
      piId = typeof pi === "string" ? pi : pi?.id ?? null;
    } else if (rental.transaction_id) {
      const tx = (
        await sql`SELECT payment_ref FROM transactions WHERE id = ${rental.transaction_id}`
      )[0];
      const ref = tx?.payment_ref;
      if (typeof ref === "string" && ref.startsWith("pi_")) piId = ref;
    }
    if (!piId) return false;
    await stripe.refunds.create(
      { payment_intent: piId, amount: amountCents },
      { idempotencyKey: `cancel_refund_${rental.id}` }
    );
    // Record the refund on the transaction so Finances (Net Take) sees it.
    if (rental.transaction_id) {
      await sql`
        UPDATE transactions
        SET refund_amount = COALESCE(refund_amount, 0) + ${amountCents / 100},
            refunded_at = COALESCE(refunded_at, now())
        WHERE id = ${rental.transaction_id}
      `.catch(() => {});
    }
    return true;
  } catch (err) {
    console.error(`[cancel] refund for rental ${rental.id} failed:`, (err as Error).message);
    return false;
  }
}

/** Re-derive an item's status from its live rentals (never touches cleaning/retired). */
async function syncItemStatus(itemId: string) {
  await sql`
    UPDATE items SET status = CASE
      WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${itemId} AND status = 'active') THEN 'rented'
      WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${itemId} AND status = 'reserved') THEN 'reserved'
      ELSE 'available'
    END, updated_at = now()
    WHERE id = ${itemId} AND status IN ('available','reserved','rented')
  `;
}

export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();

  const existing = await sql`SELECT * FROM rentals WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rental = existing[0];
  const session = await getSession(); // actor for the audit log
  let cancellation: { outcome: string; amount: number } | null = null;

  // Re-send the reservation confirmation email with the rental's CURRENT dates
  // (e.g. after correcting a booking). Uses the piece brand + customer on file.
  if (b.action === "resend_confirmation") {
    const info = (
      await sql`
        SELECT COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
               cu.name AS customer_name, cu.email AS customer_email,
               COALESCE(t.total, r.rental_price) AS total,
               to_char(r.start_date, 'YYYY-MM-DD') AS start_iso,
               to_char(r.due_date, 'YYYY-MM-DD') AS due_iso
        FROM rentals r
        JOIN items i ON i.id = r.item_id
        LEFT JOIN customers cu ON cu.id = r.customer_id
        LEFT JOIN transactions t ON t.id = r.transaction_id
        WHERE r.id = ${id}
      `
    )[0];
    if (!info?.customer_email) {
      return NextResponse.json(
        { error: "No email on file for this rental's customer." },
        { status: 400 }
      );
    }
    const r = await sendBookingConfirmation({
      to: info.customer_email,
      customerName: info.customer_name || "",
      brand: info.brand,
      startDate: fmtShort(info.start_iso),
      dueDate: fmtShort(info.due_iso),
      total: Number(info.total),
    });
    if (!r.sent) {
      return NextResponse.json(
        { error: "Couldn't send the email (is email configured?)." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, sent: true, to: info.customer_email });
  }

  // Mark a reserved piece as physically pulled into the holding area (or undo).
  // Lets the Today / Pull List clear what's done so only NEW reservations show.
  if (b.action === "pull") {
    await sql`UPDATE rentals SET pulled_at = now(), updated_at = now() WHERE id = ${id}`;
    await logAudit("rental_pull", { entity: "rental", entityId: id, detail: { item_id: rental.item_id } }, session);
    return NextResponse.json({ ok: true, pulled: true });
  }
  if (b.action === "unpull") {
    await sql`UPDATE rentals SET pulled_at = NULL, updated_at = now() WHERE id = ${id}`;
    return NextResponse.json({ ok: true, pulled: false });
  }

  if (b.action === "refund_late_fee") {
    // Admin-only — refunds are not a staff action.
    if (!(await requireAdmin()))
      return NextResponse.json({ error: "Admins only" }, { status: 403 });
    // Manually reverse late fees auto-charged on this rental (any time after the
    // fact). Refunds every collected late-fee charge back to the card, voids any
    // uncollected ones, and zeroes the recorded fee.
    const r = await refundLateFeesForRental(Number(id), 0);
    if (r.error) {
      return NextResponse.json({ error: `Couldn't refund: ${r.error}` }, { status: 400 });
    }
    await sql`UPDATE rentals SET late_fee = 0, updated_at = now() WHERE id = ${id}`;
    return NextResponse.json({ ok: true, refunded: r.refunded, charges: r.count });
  }

  if (b.action === "ship") {
    // e.closet order shipped out to the renter: reserved → active (out). The
    // consignor was already emailed when the order was logged, so no email here;
    // the settle cron pays them on the return date.
    if (rental.status !== "reserved") {
      return NextResponse.json(
        { error: "Only an awaiting-shipment order can be marked shipped" },
        { status: 400 }
      );
    }
    await sql`UPDATE rentals SET status = 'active', updated_at = now() WHERE id = ${id}`;
    await sql`
      UPDATE items SET status = 'rented', rental_count = rental_count + 1, updated_at = now()
      WHERE id = ${rental.item_id} AND status IN ('reserved', 'available')
    `;
    const updated = await sql`
      SELECT r.*, c.name AS customer_name, COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
             i.size, i.color, i.photo_url, i.ownership
      FROM rentals r LEFT JOIN customers c ON c.id = r.customer_id
      JOIN items i ON i.id = r.item_id WHERE r.id = ${id}`;
    return NextResponse.json(updated[0]);
  }

  if (b.action === "pickup") {
    if (rental.status !== "reserved") {
      return NextResponse.json(
        { error: "Only reserved bookings can be picked up" },
        { status: 400 }
      );
    }
    await sql`UPDATE rentals SET status = 'active', updated_at = now() WHERE id = ${id}`;
    await sql`
      UPDATE items SET status = 'rented', rental_count = rental_count + 1, updated_at = now()
      WHERE id = ${rental.item_id}
    `;
    // Notify the consignor (free email, best-effort) when their piece goes out.
    const consigned = await sql`
      SELECT COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.rental_price, c.name, c.email, c.portal_code, c.consignor_rate
      FROM items i JOIN consignors c ON c.id = i.consignor_id
      WHERE i.id = ${rental.item_id} AND i.ownership = 'consignment'
        AND c.email IS NOT NULL
    `;
    if (consigned.length > 0) {
      const c = consigned[0];
      await sendConsignorRentedEmail({
        to: c.email,
        consignorName: c.name,
        brand: c.brand,
        earned: Math.round(Number(rental.rental_price) * consignorShare(c.consignor_rate) * 100) / 100,
        portalCode: c.portal_code ?? null,
      });
    }
    await logAudit("rental_pickup", { entity: "rental", entityId: id, detail: { item_id: rental.item_id } }, session);
  } else if (b.action === "return") {
    if (rental.status !== "active") {
      // Safety net: a piece whose pickup was never confirmed is still 'reserved'
      // and would otherwise be un-checkable. With force=true, backfill the missed
      // pickup (mark it out, count the rental) so the return can complete and the
      // consignor payout still fires — rather than blocking staff.
      if (b.force === true && rental.status === "reserved") {
        await sql`UPDATE rentals SET status = 'active', updated_at = now() WHERE id = ${id}`;
        await sql`
          UPDATE items SET status = 'rented', rental_count = rental_count + 1, updated_at = now()
          WHERE id = ${rental.item_id} AND status <> 'rented'
        `;
        rental.status = "active";
      } else {
        return NextResponse.json(
          {
            error:
              rental.status === "reserved"
                ? "This piece's pickup was never confirmed — use Force check-in to complete the return."
                : "Only pieces that are out can be checked in",
          },
          { status: 400 }
        );
      }
    }
    const returnedDate: string = b.returned_date;
    if (!returnedDate) {
      return NextResponse.json(
        { error: "returned_date is required" },
        { status: 400 }
      );
    }
    await logAudit("rental_return", { entity: "rental", entityId: id, detail: { item_id: rental.item_id, returned_date: returnedDate } }, session);
    // due_date may arrive as a JS Date or a string depending on the driver
    const due = new Date(rental.due_date).toISOString().slice(0, 10);
    // Late fee only accrues on days the studio was OPEN (closed weekdays and
    // one-off closed dates don't count — the piece couldn't be returned then).
    const prog = await getProgram();
    const daysLate = openDaysLate(
      due,
      returnedDate,
      prog.store_closed_dates,
      prog.store_closed_weekdays
    );
    // $15/day past the rental window — owner can override (e.g. waive it)
    const lateFee =
      b.late_fee != null && b.late_fee !== ""
        ? Math.max(0, Number(b.late_fee))
        : daysLate * 15;
    // Issue type: repairable damage, total loss / not returned, or none.
    const damageKind: "repair" | "loss" | null =
      b.damage_kind === "repair" || b.damage_kind === "loss" ? b.damage_kind : null;
    const damaged = damageKind !== null || !!b.damaged;
    const damageNote: string = (b.damage_note || "").trim();
    const origin = new URL(request.url).origin;

    const it = (
      await sql`
        SELECT id, ownership, consignor_id, replacement_value,
               COALESCE(NULLIF(name, ''), brand) AS brand
        FROM items WHERE id = ${rental.item_id}
      `
    )[0];
    const replacementValue = it?.replacement_value != null ? Number(it.replacement_value) : 0;
    const repairCost =
      damageKind === "repair" && b.repair_cost != null && b.repair_cost !== ""
        ? Math.max(0, Number(b.repair_cost))
        : 0;

    await sql`
      UPDATE rentals SET
        status = 'completed',
        returned_date = ${returnedDate},
        late_fee = ${lateFee},
        damaged = ${damaged},
        damage_kind = ${damageKind},
        repair_cost = ${repairCost},
        replacement_value = ${damageKind === "loss" ? replacementValue : null},
        notes = ${
          damageNote
            ? (rental.notes ? rental.notes + " · " : "") + "Damage: " + damageNote
            : rental.notes
        },
        updated_at = now()
      WHERE id = ${id}
    `;

    // If the daily job already auto-charged more late fees than the final amount
    // (e.g. staff waived it to $0 or lowered it at check-in), refund the excess
    // back to the renter's card automatically — waiving now actually gives the
    // money back instead of just zeroing the number.
    await refundLateFeesForRental(Number(id), lateFee);

    if (damageKind === "loss") {
      // Total loss / not returned → retire the piece out of inventory.
      await sql`
        UPDATE items SET
          status = 'retired',
          retired_at = ${returnedDate},
          condition_notes = COALESCE(condition_notes || E'\n', '') ||
            '[' || ${returnedDate} || '] Total loss / not returned' ||
            ${damageNote ? " · " + damageNote : ""},
          updated_at = now()
        WHERE id = ${rental.item_id}
      `;
    } else {
      // Normal return or repairable damage → cleaning/repair; stays in stock.
      await sql`
        UPDATE items SET status = 'cleaning', updated_at = now()
        WHERE id = ${rental.item_id}
      `;
      if (damaged && damageNote) {
        await sql`
          UPDATE items SET
            condition_notes = COALESCE(condition_notes || E'\n', '') ||
              '[' || ${returnedDate} || '] ' ||
              ${(damageKind === "repair" ? "Repair" : "Damage") + ": " + damageNote},
            updated_at = now()
          WHERE id = ${rental.item_id}
        `;
      }
    }

    // GUARANTEE the consignor's full-replacement payout first — created and owed
    // regardless of whether we can collect from the renter.
    if (damageKind === "loss" && it?.ownership === "consignment" && it?.consignor_id) {
      await createConsignorLossPayout(Number(id));
    }

    // Charge the renter's saved card off-session (best-effort; on failure it's
    // flagged for follow-up with a payment link, and the consignor is still paid).
    if (damageKind === "repair" && repairCost > 0) {
      await chargeRenterForRental({
        rentalId: Number(id),
        amount: repairCost,
        kind: "repair",
        description: `Repair — ${it?.brand ?? "rental"}`,
        origin,
      });
    } else if (damageKind === "loss" && replacementValue > 0) {
      await chargeRenterForRental({
        rentalId: Number(id),
        amount: replacementValue,
        kind: "replacement",
        description: `Replacement — ${it?.brand ?? "rental"}`,
        origin,
      });
    }

    // Missing hanger / garment bag → charge the configured fee off-session.
    if (b.hanger_missing || b.garment_bag_missing) {
      const program = await getProgram();
      if (b.hanger_missing && program.hanger_fee > 0) {
        await chargeRenterForRental({
          rentalId: Number(id),
          amount: program.hanger_fee,
          kind: "hanger",
          description: `Missing hanger — ${it?.brand ?? "rental"}`,
          origin,
        });
      }
      if (b.garment_bag_missing && program.garment_bag_fee > 0) {
        await chargeRenterForRental({
          rentalId: Number(id),
          amount: program.garment_bag_fee,
          kind: "garment_bag",
          description: `Missing garment bag — ${it?.brand ?? "rental"}`,
          origin,
        });
      }
    }

    // Normal consignor 60% earnings on the completed rental (no-op for
    // owned/ambassador stock; queues if the consignor isn't onboarded yet).
    await payoutForCompletedRental(Number(id));
  } else if (b.action === "cancel") {
    if (rental.status === "completed") {
      return NextResponse.json(
        { error: "Completed rentals can't be cancelled" },
        { status: 400 }
      );
    }

    // Cancellation policy (applies only to a paid reservation):
    //  - 48+ hrs before pickup → refund the RENTAL PRICE to the card
    //    (Cleaning & Care Fee and tax are non-refundable)
    //  - within 48 hrs / after pickup / no-show → non-refundable (nothing back)
    const wasPickedUp = rental.status === "active";
    const startDate = new Date(rental.start_date).toISOString().slice(0, 10);
    const hoursUntilPickup =
      (Date.parse(`${startDate}T12:00:00Z`) - Date.now()) / 3_600_000;
    const paid = rental.paid === true;
    const rentalPrice = Math.round(Number(rental.rental_price) * 100) / 100;

    let outcome = "none";
    let amount = 0;
    if (paid && !wasPickedUp && hoursUntilPickup >= 48) {
      const ok = await refundRentalPrice(rental);
      outcome = ok ? "refund" : "refund_failed";
      amount = rentalPrice;
    }
    // else: within 48 hrs / no-show / after pickup / unpaid → non-refundable.
    cancellation = { outcome, amount };

    if (wasPickedUp) {
      // undo the pickup count; a piece that was out needs cleaning before it's
      // available again (the turnaround buffer).
      await sql`
        UPDATE items SET
          rental_count = GREATEST(rental_count - 1, 0),
          status = 'cleaning',
          updated_at = now()
        WHERE id = ${rental.item_id}
      `;
      await sql`UPDATE rentals SET status = 'cancelled', updated_at = now() WHERE id = ${id}`;
    } else {
      // Reserved but never picked up → release straight back to available.
      await sql`UPDATE rentals SET status = 'cancelled', updated_at = now() WHERE id = ${id}`;
      await syncItemStatus(rental.item_id);

      // Genuine no-show (the pickup day already passed): tell the consignor their
      // piece was never picked up so no payout is coming — right when it's
      // released, not only via the nightly job. Once, guarded by noshow_notified
      // so the cron can't also send it. Best-effort; the release already happened.
      if (hoursUntilPickup < 0 && !rental.noshow_notified) {
        try {
          const c = (
            await sql`
              SELECT co.name, co.email, COALESCE(NULLIF(i.name, ''), i.brand) AS brand
              FROM items i
              LEFT JOIN consignors co ON co.id = i.consignor_id
              WHERE i.id = ${rental.item_id} AND i.ownership = 'consignment'
            `
          )[0];
          if (c?.email) {
            await sendConsignorNoShowNotice({
              to: String(c.email),
              consignorName: String(c.name ?? ""),
              itemBrand: String(c.brand),
            });
          }
          await sql`UPDATE rentals SET noshow_notified = true WHERE id = ${id}`;
        } catch {
          /* non-fatal — the piece is already back on the rack */
        }
      }
    }
  } else if (b.start_date && b.due_date) {
    // reschedule — re-check overlaps, excluding this booking
    if (b.due_date < b.start_date) {
      return NextResponse.json(
        { error: "Due date can't be before the pickup date" },
        { status: 400 }
      );
    }
    const conflicts = await sql`
      SELECT id FROM rentals
      WHERE item_id = ${rental.item_id}
        AND id != ${id}
        AND status IN ('reserved','active')
        AND start_date <= ${b.due_date}
        AND due_date >= ${b.start_date}
    `;
    if (conflicts.length > 0) {
      return NextResponse.json(
        { error: "This piece is already booked for those dates" },
        { status: 409 }
      );
    }
    await sql`
      UPDATE rentals SET
        start_date = ${b.start_date},
        due_date = ${b.due_date},
        notes = ${b.notes !== undefined ? b.notes || null : rental.notes},
        updated_at = now()
      WHERE id = ${id}
    `;
  } else {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const rows = await sql`
    SELECT r.*, c.name AS customer_name, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.size, i.color, i.photo_url
    FROM rentals r
    LEFT JOIN customers c ON c.id = r.customer_id
    JOIN items i ON i.id = r.item_id
    WHERE r.id = ${id}
  `;
  return NextResponse.json(cancellation ? { ...rows[0], cancellation } : rows[0]);
}

// Delete a rental (e.g. clearing out practice/test data). If the piece had been
// picked up, undo the rental_count bump, then re-derive the piece's status from
// any remaining live rentals so it isn't left stranded as rented/cleaning.
export async function DELETE(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const existing = await sql`SELECT * FROM rentals WHERE id = ${id}`;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rental = existing[0];
  await sql`DELETE FROM rentals WHERE id = ${id}`;
  if (rental.status === "active" || rental.status === "completed") {
    await sql`
      UPDATE items SET rental_count = GREATEST(rental_count - 1, 0), updated_at = now()
      WHERE id = ${rental.item_id}
    `;
  }
  // Only re-derive status for pieces still in the rental cycle (not retired/cleaning).
  await sql`
    UPDATE items SET status = CASE
      WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${rental.item_id} AND status = 'active') THEN 'rented'
      WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${rental.item_id} AND status = 'reserved') THEN 'reserved'
      ELSE 'available'
    END, updated_at = now()
    WHERE id = ${rental.item_id} AND status IN ('available','reserved','rented')
  `;
  return NextResponse.json({ ok: true });
}
