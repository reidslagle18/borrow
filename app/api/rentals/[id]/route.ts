import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendConsignorRentedEmail } from "@/lib/email";
import { CONSIGNOR_SHARE } from "@/lib/types";
import { payoutForCompletedRental, createConsignorLossPayout } from "@/lib/connect";
import { chargeRenterForRental } from "@/lib/charges";
import { getProgram } from "@/lib/credits";

type Ctx = { params: Promise<{ id: string }> };

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
      SELECT COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.rental_price, c.name, c.email, c.portal_code
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
        earned: Math.round(Number(rental.rental_price) * CONSIGNOR_SHARE * 100) / 100,
        portalCode: c.portal_code ?? null,
      });
    }
  } else if (b.action === "return") {
    if (rental.status !== "active") {
      return NextResponse.json(
        { error: "Only pieces that are out can be checked in" },
        { status: 400 }
      );
    }
    const returnedDate: string = b.returned_date;
    if (!returnedDate) {
      return NextResponse.json(
        { error: "returned_date is required" },
        { status: 400 }
      );
    }
    // due_date may arrive as a JS Date or a string depending on the driver
    const due = new Date(rental.due_date).toISOString().slice(0, 10);
    const daysLate = Math.max(
      0,
      Math.round(
        (Date.parse(returnedDate) - Date.parse(due)) / 86_400_000
      )
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
    if (rental.status === "active") {
      // undo the pickup count if cancelling something already out
      await sql`
        UPDATE items SET rental_count = GREATEST(rental_count - 1, 0), updated_at = now()
        WHERE id = ${rental.item_id}
      `;
    }
    await sql`UPDATE rentals SET status = 'cancelled', updated_at = now() WHERE id = ${id}`;
    await syncItemStatus(rental.item_id);
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
  return NextResponse.json(rows[0]);
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
