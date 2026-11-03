import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendStoragePickupReminder } from "@/lib/email";

/**
 * Daily job for the underperforming-item pickup + storage lifecycle (Vercel
 * Cron — see vercel.json). Owner approval already happened (pickup_notice_sent_at
 * is set); this only automates the timed steps:
 *  - 5 days before the 30-day pickup deadline → email a reminder (once).
 *  - At the 30-day deadline with no retrieval → move the piece to storage and
 *    start the storage-window clock.
 * The storage-window expiry itself surfaces as an owner notification (no
 * auto-disposal), so it isn't handled here.
 *
 * Protected by CRON_SECRET when set (Vercel Cron sends it as a Bearer token).
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

  // Reminders: notice sent 25+ days ago (i.e. within 5 days of the 30-day
  // deadline) but not yet at the deadline, still awaiting pickup, not reminded.
  const dueReminder = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS name,
           c.name AS consignor_name, c.email AS consignor_email,
           (i.pickup_notice_sent_at + INTERVAL '30 days') AS deadline
    FROM items i JOIN consignors c ON c.id = i.consignor_id
    WHERE i.pickup_notice_sent_at IS NOT NULL
      AND i.pickup_reminder_sent_at IS NULL
      AND i.status <> 'in_storage'
      AND c.email IS NOT NULL
      AND now() >= i.pickup_notice_sent_at + INTERVAL '25 days'
      AND now() < i.pickup_notice_sent_at + INTERVAL '30 days'
  `;
  let reminded = 0;
  for (const it of dueReminder) {
    const deadlineDate = new Date(it.deadline).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const r = await sendStoragePickupReminder({
      to: String(it.consignor_email),
      consignorName: String(it.consignor_name || "there"),
      itemName: String(it.name),
      deadlineDate,
    });
    if (r.sent) {
      await sql`UPDATE items SET pickup_reminder_sent_at = now() WHERE id = ${it.id}`;
      reminded++;
    }
  }

  // Move to storage: 30-day deadline passed, never retrieved, not already there.
  const toStorage = await sql`
    UPDATE items SET
      status = 'in_storage',
      storage_started_at = now(),
      condition_notes = COALESCE(condition_notes || E'\n', '') ||
        '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Moved to storage (pickup deadline passed)',
      updated_at = now()
    WHERE pickup_notice_sent_at IS NOT NULL
      AND status <> 'in_storage'
      AND status NOT IN ('retired', 'with_consignor', 'consignor_hold')
      AND now() >= pickup_notice_sent_at + INTERVAL '30 days'
    RETURNING id
  `;

  // Activate consignor self-holds whose start date has arrived: the piece is
  // theirs from today, so flip it to 'consignor_hold' (off the shop, unbookable)
  // until an admin marks it returned. Only pieces physically on hand (available
  // or being cleaned) flip — a piece still out on a rental keeps that status and
  // flips when it comes back through the normal return path. A future-dated hold
  // stays dormant until its start day.
  const activated = await sql`
    UPDATE items i SET status = 'consignor_hold', updated_at = now()
    FROM retrieval_requests rr
    WHERE rr.item_id = i.id
      AND rr.status = 'open'
      AND i.hold_start IS NOT NULL
      AND i.hold_start <= (now() AT TIME ZONE 'America/Chicago')::date
      AND i.status IN ('available', 'cleaning')
    RETURNING i.id
  `;

  return NextResponse.json({
    ok: true,
    reminded,
    moved_to_storage: toStorage.length,
    holds_activated: activated.length,
  });
}
