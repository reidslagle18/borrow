import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { DEFAULT_PROGRAM, lastSafeRentalLeadDays } from "@/lib/types";

/**
 * Everything that needs the owner's attention, in one feed: disputed values,
 * failed off-session charges, overdue returns, pending consignor approvals,
 * overdue-vs-reservation conflicts, pieces nearing their Last Safe Rental Date,
 * deferred payouts, sizes fully out, actionable consignor holds, underperforming
 * pieces awaiting approval, and pieces unclaimed after the storage window.
 *
 * RELIABILITY: every category runs in its OWN try/catch (via `guard`), so if one
 * query fails (a transient DB hiccup, a lock, a bad row) it degrades to an empty
 * list and names itself in `errors` — it can never blank the other nine. This
 * replaced a single Promise.all that 500'd the whole feed on any one failure.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
  } catch (e) {
    console.error("[notifications] ensureSchema failed:", (e as Error).message);
  }
  let program = DEFAULT_PROGRAM;
  try {
    program = await getProgram();
  } catch (e) {
    console.error("[notifications] getProgram failed, using defaults:", (e as Error).message);
  }
  const underDays = Math.max(1, Number(program.underperformance_days) || 90);
  const storageDays = Math.max(1, Number(program.storage_window_days) || 90);
  const lead = lastSafeRentalLeadDays(program); // Last Safe Rental Date lead
  // Days before a consignor hold's start date to start reminding the owner to
  // pull the piece (default 2). A hold surfaces earlier only if it conflicts.
  const holdLead = Math.max(0, Number(program.hold_notice_lead_days ?? 2));

  // Per-category isolation: on failure, record the name and fall back to [].
  const errors: string[] = [];
  const guard = (name: string) => (e: unknown) => {
    errors.push(name);
    console.error(`[notifications] ${name} query failed:`, (e as Error)?.message);
    return [] as Record<string, unknown>[];
  };

  const [
    disputed,
    pendingApprovals,
    failedCharges,
    overdue,
    overdueReserved,
    pullSoon,
    deferredPayouts,
    sizesOut,
    retrievals,
    underperformers,
    unclaimedStorage,
    noShows,
  ] = await Promise.all([
    sql`
      SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS label,
             i.replacement_value, i.disputed_value,
             c.id AS consignor_id, c.name AS consignor_name
      FROM items i JOIN consignors c ON c.id = i.consignor_id
      WHERE i.approval_status = 'disputed'
      ORDER BY i.disputed_at DESC NULLS LAST
      LIMIT 10
    `.catch(guard("disputed")),
    sql`
      SELECT c.id, c.name, COUNT(*)::int AS n
      FROM items i JOIN consignors c ON c.id = i.consignor_id
      WHERE i.approval_status = 'pending'
      GROUP BY c.id, c.name
      ORDER BY n DESC
      LIMIT 10
    `.catch(guard("pending_approvals")),
    sql`
      SELECT ch.id, ch.amount, ch.kind, ch.payment_link_url, ch.created_at,
             cu.id AS customer_id, cu.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS item_label
      FROM customer_charges ch
      LEFT JOIN customers cu ON cu.id = ch.customer_id
      LEFT JOIN rentals r ON r.id = ch.rental_id
      LEFT JOIN items i ON i.id = r.item_id
      WHERE ch.status = 'failed'
      ORDER BY ch.created_at DESC
      LIMIT 20
    `.catch(guard("failed_charges")),
    sql`
      SELECT r.id, r.due_date, cu.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             ((now() AT TIME ZONE 'America/Chicago')::date - r.due_date)::int AS days_late
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.status = 'active' AND r.due_date < (now() AT TIME ZONE 'America/Chicago')::date
      ORDER BY r.due_date ASC
      LIMIT 20
    `.catch(guard("overdue")),
    // HIGH PRIORITY: an overdue piece that already has an upcoming reservation
    // behind it. Surfaced the moment it's overdue for max lead time.
    sql`
      SELECT r.id, r.item_id, r.barcode, ((now() AT TIME ZONE 'America/Chicago')::date - r.due_date)::int AS days_late,
             r.item_label, r.renter_name,
             res.next_customer, to_char(res.reservation_date, 'YYYY-MM-DD') AS reservation_date
      FROM (
        SELECT r.id, r.item_id, i.barcode, r.due_date,
               COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
               cu.name AS renter_name
        FROM rentals r
        JOIN items i ON i.id = r.item_id
        LEFT JOIN customers cu ON cu.id = r.customer_id
        WHERE r.status = 'active' AND r.due_date < (now() AT TIME ZONE 'America/Chicago')::date
      ) r
      JOIN LATERAL (
        SELECT r2.start_date AS reservation_date, cu2.name AS next_customer
        FROM rentals r2
        LEFT JOIN customers cu2 ON cu2.id = r2.customer_id
        WHERE r2.item_id = r.item_id AND r2.status = 'reserved'
          AND r2.start_date >= (now() AT TIME ZONE 'America/Chicago')::date
        ORDER BY r2.start_date ASC
        LIMIT 1
      ) res ON true
      ORDER BY r.due_date ASC
      LIMIT 10
    `.catch(guard("overdue_reserved")),
    // Pieces that need to be pulled for an upcoming reservation TODAY (or are
    // past due to pull) and aren't pulled yet — i.e. at/past their Last Safe
    // Rental Date. Earlier heads-ups stay on the Today pull list, NOT the bell,
    // so Needs Attention only shows pulls that are actually due now.
    sql`
      SELECT r.id AS rental_id, i.id AS item_id, i.barcode,
             COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             cu.name AS customer_name,
             to_char(r.start_date, 'YYYY-MM-DD') AS reservation_date,
             to_char(r.start_date - ${lead}::int, 'YYYY-MM-DD') AS last_safe_date,
             ((r.start_date - ${lead}::int) - (now() AT TIME ZONE 'America/Chicago')::date)::int AS days_remaining
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.status = 'reserved' AND r.start_date >= (now() AT TIME ZONE 'America/Chicago')::date
        AND (r.start_date - ${lead}::int) <= (now() AT TIME ZONE 'America/Chicago')::date
        AND r.pulled_at IS NULL
      ORDER BY (r.start_date - ${lead}::int) ASC
      LIMIT 20
    `.catch(guard("pull_soon")),
    sql`
      SELECT p.id, p.amount, c.id AS consignor_id, c.name AS consignor_name, p.notes
      FROM payouts p JOIN consignors c ON c.id = p.consignor_id
      WHERE p.status = 'pending' AND p.notes LIKE '[deferred]%'
      ORDER BY p.id DESC
      LIMIT 10
    `.catch(guard("deferred_payouts")),
    sql`
      SELECT size, COUNT(*)::int AS total
      FROM items
      WHERE status NOT IN ('retired', 'with_consignor', 'in_storage', 'consignor_hold')
        AND COALESCE(NULLIF(size, ''), '') <> ''
      GROUP BY size
      HAVING COUNT(*) >= 2
         AND COUNT(*) FILTER (WHERE status = 'available') = 0
      ORDER BY total DESC
      LIMIT 6
    `.catch(guard("sizes_out")),
    // Consignor holds — RETIMED (#4): only surface when actionable, i.e. within
    // `holdLead` days of the hold's start (a "pull the piece" reminder), OR
    // immediately if the hold conflicts with a paying customer's reservation for
    // overlapping dates (urgent). A freshly-requested future hold no longer
    // shows here at request time — it still lives on the Consignor Holds view.
    sql`
      SELECT rr.id, rr.note, rr.created_at,
             to_char(rr.hold_start, 'YYYY-MM-DD') AS hold_start,
             to_char(rr.hold_end, 'YYYY-MM-DD') AS hold_end,
             c.id AS consignor_id, c.name AS consignor_name,
             i.id AS item_id, i.barcode, i.status AS item_status,
             COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             EXISTS (
               SELECT 1 FROM rentals rc
               WHERE rc.item_id = rr.item_id AND rc.status IN ('reserved', 'active')
                 AND rc.start_date <= COALESCE(rr.hold_end, rr.hold_start)
                 AND rc.due_date >= rr.hold_start
             ) AS conflict
      FROM retrieval_requests rr
      JOIN consignors c ON c.id = rr.consignor_id
      JOIN items i ON i.id = rr.item_id
      WHERE rr.status = 'open'
        -- Drop it once it's been PULLED (prep is done) or the piece is already
        -- out with the consignor — no need to keep nagging in Today.
        AND rr.pulled_at IS NULL
        AND i.status NOT IN ('consignor_hold', 'with_consignor', 'retired')
        AND (
          rr.hold_start IS NULL
          OR rr.hold_start <= (now() AT TIME ZONE 'America/Chicago')::date + (${holdLead} * INTERVAL '1 day')
          OR EXISTS (
            SELECT 1 FROM rentals rc
            WHERE rc.item_id = rr.item_id AND rc.status IN ('reserved', 'active')
              AND rc.start_date <= COALESCE(rr.hold_end, rr.hold_start)
              AND rc.due_date >= rr.hold_start
          )
        )
      ORDER BY conflict DESC, rr.hold_start ASC NULLS FIRST, rr.created_at DESC
      LIMIT 20
    `.catch(guard("retrievals")),
    sql`
      WITH last_rental AS (
        SELECT item_id, MAX(COALESCE(returned_date, due_date, start_date)) AS last_date
        FROM rentals WHERE status = 'completed' GROUP BY item_id
      )
      SELECT i.id, i.barcode, COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             COALESCE(NULLIF(i.photos[1], ''), i.photo_url) AS photo,
             c.id AS consignor_id, c.name AS consignor_name,
             (c.email IS NOT NULL) AS has_email,
             GREATEST(
               i.created_at,
               COALESCE(lr.last_date::timestamptz, i.created_at),
               COALESCE(i.underperf_dismissed_at, i.created_at)
             ) AS since
      FROM items i
      JOIN consignors c ON c.id = i.consignor_id
      LEFT JOIN last_rental lr ON lr.item_id = i.id
      WHERE i.ownership = 'consignment'
        AND i.status IN ('available', 'cleaning')
        AND i.pickup_notice_sent_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM rentals r
          WHERE r.item_id = i.id AND r.status IN ('reserved', 'active')
        )
        AND NOT EXISTS (
          SELECT 1 FROM retrieval_requests rr
          WHERE rr.item_id = i.id AND rr.status = 'open'
        )
        AND GREATEST(
              i.created_at,
              COALESCE(lr.last_date::timestamptz, i.created_at),
              COALESCE(i.underperf_dismissed_at, i.created_at)
            ) < now() - (${underDays} * INTERVAL '1 day')
      ORDER BY since ASC
      LIMIT 20
    `.catch(guard("underperformers")),
    sql`
      SELECT i.id, i.barcode, COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             COALESCE(NULLIF(i.photos[1], ''), i.photo_url) AS photo,
             c.id AS consignor_id, c.name AS consignor_name, i.storage_started_at
      FROM items i JOIN consignors c ON c.id = i.consignor_id
      WHERE i.status = 'in_storage'
        AND i.storage_decided_at IS NULL
        AND i.storage_started_at IS NOT NULL
        AND i.storage_started_at < now() - (${storageDays} * INTERVAL '1 day')
      ORDER BY i.storage_started_at ASC
      LIMIT 20
    `.catch(guard("unclaimed_storage")),
    // No-shows: reservations whose return date has passed but were never picked
    // up (still 'reserved'). Surfaced until the owner releases the piece (Cancel
    // on the calendar) back to the rack. The nightly cron emails the consignor +
    // owner once; this keeps it visible until it's actually handled.
    sql`
      SELECT r.id, r.item_id, to_char(r.due_date, 'YYYY-MM-DD') AS due_date,
             ((now() AT TIME ZONE 'America/Chicago')::date - r.due_date)::int AS days_past_due,
             cu.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS item_label,
             i.ownership
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.status = 'reserved' AND r.due_date < (now() AT TIME ZONE 'America/Chicago')::date
      ORDER BY r.due_date ASC
      LIMIT 20
    `.catch(guard("no_shows")),
  ]);

  // Failed card charges + never-picked-up (no_shows) are intentionally excluded
  // from the Needs-attention count/feed (owner's choice) — they still come back
  // in the payload for anything else that wants them, just not surfaced here.
  const count =
    disputed.length +
    pendingApprovals.length +
    overdue.length +
    overdueReserved.length +
    pullSoon.length +
    deferredPayouts.length +
    sizesOut.length +
    retrievals.length +
    underperformers.length +
    unclaimedStorage.length;

  return NextResponse.json(
    {
      count,
      errors, // categories that couldn't be checked this cycle (usually empty)
      disputed,
      pending_approvals: pendingApprovals,
      failed_charges: failedCharges,
      overdue,
      overdue_reserved: overdueReserved,
      pull_soon: pullSoon,
      deferred_payouts: deferredPayouts,
      sizes_out: sizesOut,
      retrievals,
      underperformers,
      unclaimed_storage: unclaimedStorage,
      no_shows: noShows,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
