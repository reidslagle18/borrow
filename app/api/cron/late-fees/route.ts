import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { chargeRenterForRental } from "@/lib/charges";

const PER_DAY = 15; // $15 per item per day past due

/**
 * Daily late-fee run (Vercel Cron — see vercel.json). For each item still out
 * past its due date, charges the renter's saved card off-session $15/day, up to
 * the piece's replacement value. Tracks how much has been billed on the rental
 * (late_fee_charged) so each run only charges the new days. Failures are flagged
 * for follow-up with a payment link (handled in chargeRenterForRental).
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
  const today = new Date().toISOString().slice(0, 10);

  const overdue = await sql`
    SELECT r.id, r.due_date, r.late_fee_charged,
           i.replacement_value, COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r JOIN items i ON i.id = r.item_id
    WHERE r.status = 'active' AND r.due_date < CURRENT_DATE
  `;

  let charged = 0;
  for (const r of overdue) {
    const due = new Date(r.due_date).toISOString().slice(0, 10);
    const daysLate = Math.max(
      0,
      Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000)
    );
    if (daysLate <= 0) continue;

    const cap = Number(r.replacement_value) > 0 ? Number(r.replacement_value) : Infinity;
    const target = Math.min(daysLate * PER_DAY, cap);
    const already = Number(r.late_fee_charged) || 0;
    const delta = Math.round((target - already) * 100) / 100;
    if (delta <= 0) continue; // fully billed (or hit the replacement-value cap)

    const res = await chargeRenterForRental({
      rentalId: Number(r.id),
      amount: delta,
      kind: "late_fee",
      description: `Late fee — ${r.brand} (${daysLate} day${daysLate === 1 ? "" : "s"} late)`,
      origin,
      idempotencyKey: `latefee_${r.id}_${today}`,
    });
    // Billed (collected or flagged as owed) — record so we don't re-bill it.
    if (res.status !== "skipped") {
      await sql`UPDATE rentals SET late_fee_charged = late_fee_charged + ${delta} WHERE id = ${r.id}`;
      charged += 1;
    }
  }

  return NextResponse.json({ ok: true, overdue: overdue.length, charged });
}
