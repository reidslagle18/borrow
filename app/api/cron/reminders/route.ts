import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import {
  sendPickupReminder,
  sendDueReminder,
  sendConsignorNoShowNotice,
  sendOwnerNoShowAlert,
} from "@/lib/email";
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
  // NOTE: format the date to a YYYY-MM-DD string in SQL (to_char). The driver
  // returns DATE columns as JS Date objects, and String(date).slice(0,10) yields
  // "Wed Aug 19", which fmtShort can't parse — it rendered "Invalid Date" in the
  // reminder emails. to_char guarantees a parseable ISO string.
  const pickups = await sql`
    SELECT r.id, to_char(r.start_date, 'YYYY-MM-DD') AS start_iso,
           c.name AS customer_name, c.email, COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'reserved'
      AND r.pickup_reminded = false
      AND r.start_date = (now() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day'
      AND c.email IS NOT NULL
  `;
  let pickupSent = 0;
  for (const r of pickups) {
    const res = await sendPickupReminder({
      to: r.email,
      customerName: r.customer_name ?? "",
      brand: r.brand,
      date: fmtShort(r.start_iso),
    });
    await sql`UPDATE rentals SET pickup_reminded = true WHERE id = ${r.id}`;
    if (res.sent) pickupSent++;
  }

  // Active rentals due back tomorrow that haven't been reminded yet.
  const dues = await sql`
    SELECT r.id, to_char(r.due_date, 'YYYY-MM-DD') AS due_iso,
           c.name AS customer_name, c.email, COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'active'
      AND r.due_reminded = false
      AND r.due_date = (now() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day'
      AND c.email IS NOT NULL
  `;
  let dueSent = 0;
  for (const r of dues) {
    const res = await sendDueReminder({
      to: r.email,
      customerName: r.customer_name ?? "",
      brand: r.brand,
      date: fmtShort(r.due_iso),
    });
    await sql`UPDATE rentals SET due_reminded = true WHERE id = ${r.id}`;
    if (res.sent) dueSent++;
  }

  // No-shows: reservations whose RETURN date has passed but were never picked up
  // (still 'reserved'). The customer keeps their payment (no refund); we tell the
  // consignor there's no payout, and alert the owner it's clear to put back on the
  // rack. Notified exactly once (noshow_notified). The owner releases the piece by
  // Cancel — which, past the pickup date, refunds nothing and pays no consignor.
  const noShows = await sql`
    SELECT r.id, r.item_id, to_char(r.due_date, 'YYYY-MM-DD') AS due_iso,
           cu.name AS customer_name, i.ownership, i.consignor_id,
           COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
           co.name AS consignor_name, co.email AS consignor_email
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers cu ON cu.id = r.customer_id
    LEFT JOIN consignors co ON co.id = i.consignor_id
    WHERE r.status = 'reserved'
      AND r.noshow_notified = false
      AND r.due_date < (now() AT TIME ZONE 'America/Chicago')::date
  `;
  let consignorNoShowSent = 0;
  let ownerNoShowSent = 0;
  for (const r of noShows) {
    if (r.ownership === "consignment" && r.consignor_email) {
      const cr = await sendConsignorNoShowNotice({
        to: r.consignor_email,
        consignorName: r.consignor_name ?? "",
        itemBrand: r.brand,
      });
      if (cr.sent) consignorNoShowSent++;
    }
    const or = await sendOwnerNoShowAlert({
      itemBrand: r.brand,
      itemId: r.item_id,
      customerName: r.customer_name ?? null,
      dueDate: fmtShort(String(r.due_iso)),
    });
    if (or.sent) ownerNoShowSent++;
    await sql`UPDATE rentals SET noshow_notified = true WHERE id = ${r.id}`;
  }

  return NextResponse.json({
    ok: true,
    pickup_reminders: pickupSent,
    pickup_candidates: pickups.length,
    due_reminders: dueSent,
    due_candidates: dues.length,
    noshow_candidates: noShows.length,
    noshow_consignor_emails: consignorNoShowSent,
    noshow_owner_emails: ownerNoShowSent,
  });
}
