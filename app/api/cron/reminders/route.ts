import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendPickupReminder, sendDueReminder } from "@/lib/email";
import { fmtShort } from "@/lib/dates";

/**
 * Daily reminder job (run by Vercel Cron — see vercel.json).
 * - Pickup reminders: reserved rentals starting tomorrow.
 * - Return reminders: active rentals due tomorrow.
 * Each rental is reminded once (pickup_reminded / due_reminded flags).
 *
 * Protected by CRON_SECRET when set: Vercel Cron sends it as a Bearer token.
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

  // Pickups happening tomorrow that haven't been reminded yet.
  const pickups = await sql`
    SELECT r.id, r.start_date, c.name AS customer_name, c.email, i.brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'reserved'
      AND r.pickup_reminded = false
      AND r.start_date = CURRENT_DATE + INTERVAL '1 day'
      AND c.email IS NOT NULL
  `;
  let pickupSent = 0;
  for (const r of pickups) {
    const res = await sendPickupReminder({
      to: r.email,
      customerName: r.customer_name ?? "",
      brand: r.brand,
      date: fmtShort(String(r.start_date).slice(0, 10)),
    });
    await sql`UPDATE rentals SET pickup_reminded = true WHERE id = ${r.id}`;
    if (res.sent) pickupSent++;
  }

  // Active rentals due back tomorrow that haven't been reminded yet.
  const dues = await sql`
    SELECT r.id, r.due_date, c.name AS customer_name, c.email, i.brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'active'
      AND r.due_reminded = false
      AND r.due_date = CURRENT_DATE + INTERVAL '1 day'
      AND c.email IS NOT NULL
  `;
  let dueSent = 0;
  for (const r of dues) {
    const res = await sendDueReminder({
      to: r.email,
      customerName: r.customer_name ?? "",
      brand: r.brand,
      date: fmtShort(String(r.due_date).slice(0, 10)),
    });
    await sql`UPDATE rentals SET due_reminded = true WHERE id = ${r.id}`;
    if (res.sent) dueSent++;
  }

  return NextResponse.json({
    ok: true,
    pickup_reminders: pickupSent,
    pickup_candidates: pickups.length,
    due_reminders: dueSent,
    due_candidates: dues.length,
  });
}
