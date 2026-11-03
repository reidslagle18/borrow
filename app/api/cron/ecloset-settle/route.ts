import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { payoutForCompletedRental } from "@/lib/connect";

/**
 * Settle e.closet rentals once their return date has passed — the e.closet
 * equivalent of checking an in-store order back in. Borrow never gets a live
 * "returned" signal from e.closet, so we treat the due date as the return:
 * mark the rental completed, send the piece to cleaning, and fire the consignor
 * payout (their normal cut + the $10 e.closet bonus, handled in
 * payoutForCompletedRental). Idempotent — a rental only settles once.
 * Protected by CRON_SECRET when set.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  await ensureSchema();

  const due = await sql`
    SELECT id, item_id
    FROM rentals
    WHERE source = 'ecloset'
      AND status IN ('reserved', 'active')
      AND due_date < (now() AT TIME ZONE 'America/Chicago')::date
    ORDER BY id ASC
  `;

  let settled = 0;
  for (const r of due) {
    const id = Number(r.id);
    await sql`
      UPDATE rentals SET status = 'completed', returned_date = due_date, updated_at = now()
      WHERE id = ${id} AND status IN ('reserved', 'active')
    `;
    // The piece is on its way back — hold it for cleaning until "Back on rack".
    await sql`
      UPDATE items SET status = 'cleaning', updated_at = now()
      WHERE id = ${r.item_id} AND status IN ('reserved', 'rented')
    `;
    // Fire the consignor payout (rate × price + $10 e.closet bonus; idempotent).
    await payoutForCompletedRental(id);
    settled++;
  }

  return NextResponse.json({ ok: true, settled });
}
