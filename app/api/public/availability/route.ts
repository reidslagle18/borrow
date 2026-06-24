import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Public, read-only availability feed for the customer-facing site.
 * Exposes the rentable collection and each piece's booked date ranges —
 * no customer names, no costs, no notes.
 */
export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT
      i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.size, i.color, i.silhouette, i.tier, i.rental_price, i.retail_value,
      i.event_types, i.photo_url, i.photos, i.status,
      COALESCE(
        json_agg(
          json_build_object('start_date', r.start_date, 'due_date', r.due_date)
          ORDER BY r.start_date
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'
      ) AS booked
    FROM items i
    LEFT JOIN rentals r
      ON r.item_id = i.id
     AND r.status IN ('reserved','active')
     AND r.due_date >= CURRENT_DATE
    WHERE i.status NOT IN ('retired', 'with_consignor')
    GROUP BY i.id
    ORDER BY i.created_at DESC
  `;
  return NextResponse.json(rows, {
    headers: { "Cache-Control": "no-store" },
  });
}
