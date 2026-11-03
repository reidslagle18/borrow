import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * All open consignor self-holds, for the studio's planning view. Each carries
 * the date range the consignor requested. `active` = the hold has started (the
 * piece is out with them now); `past_end` = today is past their requested end
 * date but the piece hasn't been marked returned yet (follow up).
 */
export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT rr.id, rr.note, rr.created_at,
           to_char(rr.hold_start, 'YYYY-MM-DD') AS hold_start,
           to_char(rr.hold_end, 'YYYY-MM-DD') AS hold_end,
           c.id AS consignor_id, c.name AS consignor_name, c.email AS consignor_email,
           i.id AS item_id, i.barcode,
           COALESCE(NULLIF(i.name, ''), i.brand) AS item_name,
           i.photo_url, i.status AS item_status,
           (rr.hold_start IS NOT NULL AND rr.hold_start <= (now() AT TIME ZONE 'America/Chicago')::date) AS active,
           (rr.hold_end IS NOT NULL AND rr.hold_end < (now() AT TIME ZONE 'America/Chicago')::date) AS past_end
    FROM retrieval_requests rr
    JOIN consignors c ON c.id = rr.consignor_id
    JOIN items i ON i.id = rr.item_id
    WHERE rr.status = 'open'
    ORDER BY rr.hold_start ASC NULLS FIRST, rr.created_at ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
