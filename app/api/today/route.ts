import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Morning "Today" dashboard feed: pickups scheduled today, returns due today,
 * anything overdue, and drop-off appointments today.
 */
export async function GET() {
  await ensureSchema();

  const [pickups, returnsToday, overdue, dropoffs] = await Promise.all([
    sql`
      SELECT r.id, r.item_id, r.status, r.start_date, r.due_date,
             c.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.barcode, i.size, i.tier, i.photo_url
      FROM rentals r
      LEFT JOIN customers c ON c.id = r.customer_id
      JOIN items i ON i.id = r.item_id
      WHERE r.status = 'reserved' AND r.start_date = CURRENT_DATE
      ORDER BY c.name ASC
    `,
    sql`
      SELECT r.id, r.item_id, r.status, r.start_date, r.due_date,
             c.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.barcode, i.size, i.tier, i.photo_url
      FROM rentals r
      LEFT JOIN customers c ON c.id = r.customer_id
      JOIN items i ON i.id = r.item_id
      WHERE r.status = 'active' AND r.due_date = CURRENT_DATE
      ORDER BY c.name ASC
    `,
    sql`
      SELECT r.id, r.item_id, r.status, r.start_date, r.due_date,
             c.name AS customer_name,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.barcode, i.size, i.tier, i.photo_url
      FROM rentals r
      LEFT JOIN customers c ON c.id = r.customer_id
      JOIN items i ON i.id = r.item_id
      WHERE r.status = 'active' AND r.due_date < CURRENT_DATE
      ORDER BY r.due_date ASC
    `,
    sql`
      SELECT a.id, a.slot_time, a.name, a.phone, a.item_count, a.consignor_id
      FROM drop_off_appointments a
      WHERE a.status = 'booked' AND a.slot_date = CURRENT_DATE
      ORDER BY a.slot_time ASC
    `,
  ]);

  return NextResponse.json(
    { pickups, returns_today: returnsToday, overdue, dropoffs },
    { headers: { "Cache-Control": "no-store" } }
  );
}
