import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendPickupReminder, sendDueReminder } from "@/lib/email";
import { fmtShort } from "@/lib/dates";

// Paced sends (600ms each) for a dozen+ emails can run several seconds.
export const maxDuration = 60;

/**
 * Admin-only (gated by proxy.ts): one-off corrective re-send of the pickup /
 * return reminders for TOMORROW to exactly the rentals that were already
 * reminded (pickup_reminded / due_reminded = true) — i.e. the customers who got
 * the earlier "Invalid Date" email. Dates are formatted via to_char so they're
 * always valid. Pass { hours } to include an open-hours line, { dryRun: true }
 * to just preview who'd be emailed. Does not change the reminded flags.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const hours =
    typeof b.hours === "string" && b.hours.trim() ? b.hours.trim() : undefined;
  const dryRun = b.dryRun === true;

  const pickups = await sql`
    SELECT r.id, to_char(r.start_date, 'YYYY-MM-DD') AS iso,
           c.name AS customer_name, c.email, COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'reserved'
      AND r.pickup_reminded = true
      AND r.start_date = (now() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day'
      AND c.email IS NOT NULL
  `;
  const dues = await sql`
    SELECT r.id, to_char(r.due_date, 'YYYY-MM-DD') AS iso,
           c.name AS customer_name, c.email, COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'active'
      AND r.due_reminded = true
      AND r.due_date = (now() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day'
      AND c.email IS NOT NULL
  `;

  // One reminder per unique email address (a customer with several pieces gets
  // ONE corrected reminder, not one per piece) — keeps the corrective send from
  // spamming multi-piece renters.
  const uniqBy = <T extends { email: string }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    return rows.filter((r) =>
      seen.has(r.email) ? false : (seen.add(r.email), true)
    );
  };
  const pk = uniqBy(pickups);
  const du = uniqBy(dues);

  if (dryRun) {
    const recipients = Array.from(
      new Set([...pk, ...du].map((r) => r.email))
    );
    return NextResponse.json({
      dryRun: true,
      pickup_emails: pk.length,
      due_emails: du.length,
      unique_recipients: recipients.length,
      recipients,
    });
  }

  // Pace sends to stay under Resend's rate limit (bursting caused earlier misses).
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const failed: { email: string; error?: string; kind: string }[] = [];

  let pickupSent = 0;
  for (const r of pk) {
    const res = await sendPickupReminder({
      to: r.email,
      customerName: r.customer_name ?? "",
      brand: r.brand,
      date: fmtShort(r.iso),
      hours,
    });
    if (res.sent) pickupSent++;
    else failed.push({ email: r.email, error: res.error, kind: "pickup" });
    await sleep(600);
  }
  let dueSent = 0;
  for (const r of du) {
    const res = await sendDueReminder({
      to: r.email,
      customerName: r.customer_name ?? "",
      brand: r.brand,
      date: fmtShort(r.iso),
      hours,
    });
    if (res.sent) dueSent++;
    else failed.push({ email: r.email, error: res.error, kind: "due" });
    await sleep(600);
  }

  return NextResponse.json({
    ok: true,
    pickup_sent: pickupSent,
    due_sent: dueSent,
    failed,
  });
}
