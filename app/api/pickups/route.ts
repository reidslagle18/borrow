import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";

/**
 * Feeds the Storage & Pickups view: pieces on an active 30-day pickup clock
 * ("Awaiting Pickup") and pieces moved to storage on the storage-window clock
 * ("In Storage"). Pieces with an open retrieval request drop off both lists
 * (their clock is cancelled). Sorted by nearest deadline first.
 */
export async function GET() {
  await ensureSchema();
  const storageDays = Math.max(1, Number((await getProgram()).storage_window_days) || 90);

  const [awaitingPickup, inStorage] = await Promise.all([
    sql`
      SELECT i.id, i.barcode, COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             COALESCE(NULLIF(i.photos[1], ''), i.photo_url) AS photo,
             c.id AS consignor_id, c.name AS consignor_name,
             i.pickup_notice_sent_at,
             (i.pickup_notice_sent_at + INTERVAL '30 days') AS deadline,
             CEIL(EXTRACT(EPOCH FROM (i.pickup_notice_sent_at + INTERVAL '30 days' - now())) / 86400)::int AS days_remaining
      FROM items i JOIN consignors c ON c.id = i.consignor_id
      WHERE i.pickup_notice_sent_at IS NOT NULL
        AND i.status <> 'in_storage'
        AND i.status NOT IN ('retired', 'with_consignor', 'consignor_hold')
        AND NOT EXISTS (
          SELECT 1 FROM retrieval_requests rr WHERE rr.item_id = i.id AND rr.status = 'open'
        )
      ORDER BY deadline ASC
    `,
    sql`
      SELECT i.id, i.barcode, COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             COALESCE(NULLIF(i.photos[1], ''), i.photo_url) AS photo,
             c.id AS consignor_id, c.name AS consignor_name,
             i.storage_started_at,
             (i.storage_started_at + (${storageDays} * INTERVAL '1 day')) AS storage_deadline,
             CEIL(EXTRACT(EPOCH FROM (i.storage_started_at + (${storageDays} * INTERVAL '1 day') - now())) / 86400)::int AS days_remaining
      FROM items i JOIN consignors c ON c.id = i.consignor_id
      WHERE i.status = 'in_storage'
        AND i.storage_started_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM retrieval_requests rr WHERE rr.item_id = i.id AND rr.status = 'open'
        )
      ORDER BY storage_deadline ASC
    `,
  ]);

  return NextResponse.json(
    { awaiting_pickup: awaitingPickup, in_storage: inStorage, storage_window_days: storageDays },
    { headers: { "Cache-Control": "no-store" } }
  );
}
