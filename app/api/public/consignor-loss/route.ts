import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { createConsignorLossPayout } from "@/lib/connect";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY). Record a consignment piece as a
 * total loss and pay the consignor their FULL replacement value — WITHOUT charging
 * any renter. Intended for owner-use/comp rentals (no customer) where the piece
 * was ruined: the consignor is made whole, the piece is retired, the rental is
 * closed. (The normal return-with-loss flow also tries to charge the renter, which
 * is wrong when there's no customer — this skips that.)
 *
 * Body: { rental_id, note? }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const rentalId = Number(b.rental_id);
  if (!rentalId) {
    return NextResponse.json({ error: "rental_id required" }, { status: 400 });
  }
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;

  const r = (
    await sql`
      SELECT r.id, r.item_id, r.status, i.ownership, i.consignor_id,
             i.replacement_value, COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
             c.name AS consignor_name
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN consignors c ON c.id = i.consignor_id
      WHERE r.id = ${rentalId}
    `
  )[0];
  if (!r) return NextResponse.json({ error: "Rental not found" }, { status: 404 });
  if (r.ownership !== "consignment" || !r.consignor_id) {
    return NextResponse.json({ error: "Not a consignment piece — no consignor to pay." }, { status: 400 });
  }
  const amount = Math.round(Number(r.replacement_value || 0) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: "This piece has no replacement value set." }, { status: 400 });
  }

  // 1) Close the rental as a total loss; record the replacement value on it so the
  //    loss payout uses exactly this amount.
  await sql`
    UPDATE rentals SET
      status = 'completed',
      returned_date = COALESCE(returned_date, (now() AT TIME ZONE 'America/Chicago')::date),
      damaged = true,
      damage_kind = 'loss',
      replacement_value = ${amount},
      updated_at = now()
    WHERE id = ${rentalId}
  `;

  // 2) Pay the consignor their FULL replacement value (Stripe transfer if onboarded,
  //    else queued) + sends them the loss notice. Idempotent per loss_rental_id.
  await createConsignorLossPayout(rentalId);

  // 3) Retire the piece out of inventory.
  await sql`
    UPDATE items SET
      status = 'retired',
      retired_at = (now() AT TIME ZONE 'America/Chicago')::date,
      condition_notes = COALESCE(condition_notes || E'\n', '') ||
        '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Total loss' ||
        ${note ? " · " + note : ""},
      updated_at = now()
    WHERE id = ${r.item_id}
  `;

  return NextResponse.json({
    ok: true,
    rental_id: rentalId,
    item_id: r.item_id,
    consignor: r.consignor_name,
    replacement_paid: amount,
    retired: true,
  });
}
