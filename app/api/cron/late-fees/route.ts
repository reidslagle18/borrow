import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { chargeRenterForRental } from "@/lib/charges";
import { getProgram } from "@/lib/credits";
import { openDaysLate } from "@/lib/types";
import { todayISO } from "@/lib/dates";

const PER_DAY = 15; // $15 per item per day past due
const LATE_CAP_DAYS = 14; // charge the daily late fee for this many days (2 weeks)...

/**
 * Daily late-fee run (Vercel Cron — see vercel.json). For each item still out
 * past its due date:
 *  1. Charges $15/item/day for up to LATE_CAP_DAYS (2 weeks) — NO longer capped
 *     at the piece's replacement value, so the full 2 weeks always accrues.
 *  2. Once it's 2+ weeks late, ALSO charges the full replacement value once (the
 *     piece is treated as kept/lost) — collected on top of the 2 weeks of fees.
 * Both are charged to the renter's saved card off-session. `late_fee_charged`
 * tracks fees billed so each run only bills new days; a `replacement` charge row
 * (any status) marks the replacement as billed so it's never attempted twice.
 * Failures are flagged for follow-up with a payment link (in chargeRenterForRental).
 *
 * NOTE: charging the replacement to the RENTER does not by itself pay the
 * consignor or retire the piece — that still happens when the owner records the
 * loss, so a real person decides a piece is truly gone.
 *
 * Protected by CRON_SECRET when set (Bearer token from Vercel Cron).
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
  const origin = new URL(request.url).origin;
  const today = todayISO();
  const program = await getProgram();
  const closed = program.store_closed_dates;
  const closedWeekdays = program.store_closed_weekdays;

  const overdue = await sql`
    SELECT r.id, r.due_date, r.late_fee_charged,
           COALESCE(r.replacement_value, i.replacement_value) AS replacement_value,
           COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
           EXISTS (
             SELECT 1 FROM customer_charges cc
             WHERE cc.rental_id = r.id AND cc.kind = 'replacement'
           ) AS replacement_billed
    FROM rentals r JOIN items i ON i.id = r.item_id
    WHERE r.status = 'active' AND r.due_date < (now() AT TIME ZONE 'America/Chicago')::date
  `;

  let lateCharged = 0;
  let replacementCharged = 0;
  for (const r of overdue) {
    const due = new Date(r.due_date).toISOString().slice(0, 10);
    // Calendar days elapsed — used only for the replacement threshold (a piece
    // that's been gone 2 weeks is likely lost no matter the studio's hours).
    const calDaysLate = Math.max(
      0,
      Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000)
    );
    // Daily late fee only accrues on days the studio was OPEN — no charging for
    // closed weekdays or one-off closed dates, when the piece couldn't be returned.
    const openLate = openDaysLate(due, today, closed, closedWeekdays);
    if (calDaysLate <= 0) continue;

    // 1) Daily late fee for up to 2 weeks of OPEN days (full $15/day, no replacement cap).
    const lateDays = Math.min(openLate, LATE_CAP_DAYS);
    const lateTarget = lateDays * PER_DAY;
    const already = Number(r.late_fee_charged) || 0;
    const delta = Math.round((lateTarget - already) * 100) / 100;
    if (delta > 0) {
      const res = await chargeRenterForRental({
        rentalId: Number(r.id),
        amount: delta,
        kind: "late_fee",
        description: `Late fee — ${r.brand} (${lateDays} open day${lateDays === 1 ? "" : "s"} late)`,
        origin,
        idempotencyKey: `latefee_${r.id}_${today}`,
      });
      if (res.status !== "skipped") {
        await sql`UPDATE rentals SET late_fee_charged = late_fee_charged + ${delta} WHERE id = ${r.id}`;
        lateCharged += 1;
      }
    }

    // 2) At 2+ weeks late (calendar), charge the full replacement value once, on top.
    const replacement = Number(r.replacement_value) || 0;
    if (calDaysLate >= LATE_CAP_DAYS && replacement > 0 && !r.replacement_billed) {
      const res = await chargeRenterForRental({
        rentalId: Number(r.id),
        amount: replacement,
        kind: "replacement",
        description: `Replacement value — ${r.brand} (${calDaysLate} days past due)`,
        origin,
        // default key `charge_replacement_<id>` → one replacement charge ever.
      });
      if (res.status !== "skipped") replacementCharged += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    overdue: overdue.length,
    late_charged: lateCharged,
    replacement_charged: replacementCharged,
  });
}
