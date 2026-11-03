import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";

/**
 * Public, read-only availability feed for the customer-facing site.
 * Exposes the rentable collection and each piece's booked date ranges —
 * no customer names, no costs, no notes.
 */
export async function GET() {
  await ensureSchema();
  // NOTE: the shop now leads with popularity (clicks + rentals) for EVERY piece
  // — the manual Recommended pinning is turned off (owner's choice 2026-08-31).
  // The `recommended_order` setting is still stored and the /recommended admin
  // page still works; to bring the pin back, restore the
  // `array_position(<order>::text[], i.id) NULLS LAST,` line in the ORDER BY.
  // Extend each booking's blocked window by the cleaning/turnaround buffer so
  // the shop shows a piece as unavailable through its buffer, not just its due
  // date. (The final booking gate in createBooking enforces the same buffer.)
  const buffer = (await getProgram()).turnaround_days;
  const rows = await sql`
    SELECT
      i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.description, i.size, i.color, i.silhouette, i.style_tags, i.occasion_tags, i.sub_occasion_tags, i.tier, i.rental_price, i.retail_value,
      i.event_types, i.photo_url, i.photos, i.status, i.set_group, i.hold_start, i.hold_end,
      COALESCE(
        json_agg(
          json_build_object(
            'start_date', r.start_date,
            -- For an overdue-but-not-yet-returned piece we don't know when it'll
            -- actually come back, so keep it blocked through at least today (+
            -- the cleaning buffer) instead of freeing it on its original due
            -- date. GREATEST() leaves normal, on-time bookings unchanged.
            'due_date', (GREATEST(r.due_date, (now() AT TIME ZONE 'America/Chicago')::date) + COALESCE(i.turnaround_override, ${buffer})::int)
          )
          ORDER BY r.start_date
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'
      ) AS booked
    FROM items i
    LEFT JOIN rentals r
      ON r.item_id = i.id
      -- A reserved booking blocks its future window; an ACTIVE (picked-up) piece
      -- blocks until it is actually returned, overdue included. The old
      -- due_date-greater-or-equal-today filter wrongly dropped overdue actives,
      -- so a piece a customer had not brought back showed as available again.
     AND (
       (r.status = 'reserved' AND r.due_date >= (now() AT TIME ZONE 'America/Chicago')::date)
       OR (r.status = 'active' AND r.returned_date IS NULL)
     )
    -- 'cleaning' pieces are held off the shop until staff tap "Back on rack"
    -- (which flips them back to 'available'), so a piece being cleaned after a
    -- return can't be booked while it's still in the wash.
    WHERE i.status NOT IN ('retired', 'with_consignor', 'in_storage', 'consignor_hold', 'cleaning')
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
    -- Popularity leads the whole shop: score = clicks + rentals, with a rental
    -- counting much more than a click (a completed rental is a far stronger
    -- signal of demand than a browse). Ties fall back to newest.
    ORDER BY (COALESCE(i.click_count, 0) + COALESCE(i.rental_count, 0) * 20) DESC,
             i.created_at ASC
  `;
  // Surface an upcoming consignor self-hold as a blocked range covering EXACTLY
  // the dates they requested — [hold_start, hold_end] — so the shop calendar
  // greys out only those days (never a runaway default). Once the hold begins,
  // the piece flips to 'consignor_hold' status and is filtered out above, so
  // this only affects the window before a future-dated hold starts. Not a real
  // booking, so no customer data is exposed.
  const feed = rows.map(({ hold_start, hold_end, ...rest }) => {
    if (!hold_start) return rest;
    const start = new Date(hold_start).toISOString().slice(0, 10);
    const end = hold_end
      ? new Date(hold_end).toISOString().slice(0, 10)
      : start;
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
