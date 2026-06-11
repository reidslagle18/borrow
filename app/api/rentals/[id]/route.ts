import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

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
    const damaged = !!b.damaged;
    const damageNote: string = (b.damage_note || "").trim();

    await sql`
      UPDATE rentals SET
        status = 'completed',
        returned_date = ${returnedDate},
        late_fee = ${lateFee},
        damaged = ${damaged},
        notes = ${
          damageNote
            ? (rental.notes ? rental.notes + " · " : "") + "Damage: " + damageNote
            : rental.notes
        },
        updated_at = now()
      WHERE id = ${id}
    `;
    // Every return goes through cleaning before it's back on the rack
    await sql`
      UPDATE items SET status = 'cleaning', updated_at = now()
      WHERE id = ${rental.item_id}
    `;
    if (damaged && damageNote) {
      await sql`
        UPDATE items SET
          condition_notes = COALESCE(condition_notes || E'\n', '') ||
            '[' || ${returnedDate} || '] Damage: ' || ${damageNote},
          updated_at = now()
        WHERE id = ${rental.item_id}
      `;
    }
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
    SELECT r.*, c.name AS customer_name, i.brand, i.size, i.color, i.photo_url
    FROM rentals r
    LEFT JOIN customers c ON c.id = r.customer_id
    JOIN items i ON i.id = r.item_id
    WHERE r.id = ${id}
  `;
  return NextResponse.json(rows[0]);
}
