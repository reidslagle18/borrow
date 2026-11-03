import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { lastSafeRentalLeadDays } from "@/lib/types";

/**
 * Morning "Today" dashboard feed: pickups scheduled today, returns due today,
 * anything overdue, drop-off appointments today, and pieces at/near their Last
 * Safe Rental Date that should be pulled for an upcoming reservation.
 */
export async function GET() {
  await ensureSchema();
  const lead = lastSafeRentalLeadDays(await getProgram());

  const [pickups, returnsToday, overdue, dropoffs, pullReservations] = await Promise.all([
    sql`
      SELECT r.id, r.item_id, r.status, r.start_date, r.due_date,
             c.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.barcode, i.size, i.tier, i.photo_url
      FROM rentals r
      LEFT JOIN customers c ON c.id = r.customer_id
      JOIN items i ON i.id = r.item_id
      WHERE r.status = 'reserved' AND r.start_date = (now() AT TIME ZONE 'America/Chicago')::date
      ORDER BY c.name ASC
    `,
    sql`
      SELECT r.id, r.item_id, r.status, r.start_date, r.due_date,
             c.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.barcode, i.size, i.tier, i.photo_url
      FROM rentals r
      LEFT JOIN customers c ON c.id = r.customer_id
      JOIN items i ON i.id = r.item_id
      WHERE r.status = 'active' AND r.due_date = (now() AT TIME ZONE 'America/Chicago')::date
      ORDER BY c.name ASC
    `,
    sql`
      SELECT r.id, r.item_id, r.status, r.start_date, r.due_date,
             c.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.barcode, i.size, i.tier, i.photo_url
      FROM rentals r
      LEFT JOIN customers c ON c.id = r.customer_id
      JOIN items i ON i.id = r.item_id
      WHERE r.status = 'active' AND r.due_date < (now() AT TIME ZONE 'America/Chicago')::date
      ORDER BY r.due_date ASC
    `,
    sql`
      SELECT a.id, a.slot_time, a.name, a.phone, a.item_count, a.consignor_id
      FROM drop_off_appointments a
      WHERE a.status = 'booked' AND a.slot_date = (now() AT TIME ZONE 'America/Chicago')::date
      ORDER BY a.slot_time ASC
    `,
    // Pieces at or within 3 days of their Last Safe Rental Date — pull these
    // from the browsable racks into the Reserved holding area.
    sql`
      SELECT r.id AS rental_id, i.id AS item_id, i.barcode, i.size, i.photo_url,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
             cu.name AS customer_name,
             to_char(r.start_date, 'YYYY-MM-DD') AS reservation_date,
             to_char(r.start_date - ${lead}::int, 'YYYY-MM-DD') AS last_safe_date,
             ((r.start_date - ${lead}::int) - (now() AT TIME ZONE 'America/Chicago')::date)::int AS days_remaining,
             (r.pulled_at IS NOT NULL) AS pulled
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.status = 'reserved' AND r.start_date >= (now() AT TIME ZONE 'America/Chicago')::date
        AND (r.start_date - ${lead}::int) <= (now() AT TIME ZONE 'America/Chicago')::date + 3
      ORDER BY (r.start_date - ${lead}::int) ASC
    `,
  ]);

  return NextResponse.json(
    {
      pickups,
      returns_today: returnsToday,
      overdue,
      dropoffs,
      pull_reservations: pullReservations,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
