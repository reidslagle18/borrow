import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";

/**
 * Public, read-only FULL-COLLECTION feed for the customer-facing "Lookbook"
 * (view-only) page. Unlike /api/public/availability — which only lists pieces
 * that can actually be booked — this shows EVERYTHING the studio owns so people
 * can browse the whole range: pieces that are available, rented out right now,
 * being cleaned, on a consignor hold, archived (in storage), or back with their
 * consignor. It carries each piece's raw `status` + booked ranges so the shop
 * can label availability, but it is NOT a booking feed — the shop never lets a
 * piece be reserved from the Lookbook.
 *
 * Still hidden: `retired` pieces (gone from the collection for good) and
 * consignment pieces that haven't cleared approval yet (same gate as the
 * availability feed — a consignor's whole drop-off batch must be approved
 * before any of it shows publicly).
 *
 * Exposes only piece attributes + blocked date ranges — no customer names,
 * costs, or notes — exactly like the availability feed.
 */
export async function GET() {
  await ensureSchema();
  const buffer = (await getProgram()).turnaround_days;
  const rows = await sql`
    SELECT
      i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.description, i.size, i.color, i.silhouette, i.style_tags, i.occasion_tags, i.sub_occasion_tags, i.tier, i.rental_price, i.retail_value,
      i.event_types, i.photo_url, i.photos, i.status, i.set_group, i.hold_start, i.hold_end,
      COALESCE(
        json_agg(
          json_build_object(
            'start_date', r.start_date,
            -- Keep an overdue-but-unreturned piece blocked through today (+ buffer)
            -- instead of freeing it on its original due date. See availability feed.
            'due_date', (GREATEST(r.due_date, (now() AT TIME ZONE 'America/Chicago')::date) + COALESCE(i.turnaround_override, ${buffer})::int)
          )
          ORDER BY r.start_date
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'
      ) AS booked
    FROM items i
    LEFT JOIN rentals r
      ON r.item_id = i.id
      -- Reserved blocks its future window; an ACTIVE (picked-up) piece blocks
      -- until actually returned, overdue included (the old due_date-cutoff
      -- filter wrongly freed pieces a customer had not brought back yet).
     AND (
       (r.status = 'reserved' AND r.due_date >= (now() AT TIME ZONE 'America/Chicago')::date)
       OR (r.status = 'active' AND r.returned_date IS NULL)
     )
    -- Show the whole collection EXCEPT pieces that are gone for good. Cleaning /
    -- consignor_hold / in_storage / with_consignor pieces ARE included here (the
    -- availability feed hides them) so the Lookbook can display them view-only.
    WHERE i.status <> 'retired'
      -- Consignment pieces only show once approved AND their consignor has no
      -- pieces still pending/disputed (the whole drop-off batch is cleared).
      AND (
        i.ownership <> 'consignment'
        OR (
          i.approval_status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM items s
            WHERE s.consignor_id = i.consignor_id
              AND s.approval_status IN ('pending', 'disputed')
          )
        )
      )
    GROUP BY i.id
    -- Same popularity ordering as the shop: score = clicks + rentals (a rental
    -- counts far more than a click); ties fall back to newest.
    ORDER BY (COALESCE(i.click_count, 0) + COALESCE(i.rental_count, 0) * 20) DESC,
             i.created_at ASC
  `;
  // Surface an upcoming consignor self-hold as a blocked range covering exactly
  // the requested [hold_start, hold_end] window (same as the availability feed).
  const feed = rows.map(({ hold_start, hold_end, ...rest }) => {
    if (!hold_start) return rest;
    const start = new Date(hold_start).toISOString().slice(0, 10);
    const end = hold_end ? new Date(hold_end).toISOString().slice(0, 10) : start;
    return {
      ...rest,
      booked: [
        ...(rest.booked as unknown[]),
        { start_date: start, due_date: end },
      ],
    };
  });
  return NextResponse.json(feed, {
    headers: { "Cache-Control": "no-store" },
  });
}
