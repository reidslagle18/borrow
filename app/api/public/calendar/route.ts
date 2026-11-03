import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Public, keyed booking feed for the shareable calendar (borrowfayetteville.com
 * /calendar + its iCal subscribe URL). Anonymized on purpose — pieces + dates +
 * which channel (Borrow vs e.closet), NO customer names — so it's safe to hand
 * out / subscribe to without exposing the admin or customer data.
 */
export async function GET(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const rows = await sql`
    SELECT r.id,
           COALESCE(NULLIF(i.name, ''), i.brand) AS piece,
           i.barcode,
           to_char(r.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(r.due_date, 'YYYY-MM-DD') AS due_date,
           r.status,
           CASE WHEN r.source = 'ecloset' THEN 'ecloset' ELSE 'borrow' END AS channel
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    WHERE r.status IN ('reserved', 'active')
      AND r.due_date >= (now() AT TIME ZONE 'America/Chicago')::date - 1
    ORDER BY r.start_date ASC, piece ASC
  `;
  return NextResponse.json({ bookings: rows }, { headers: { "Cache-Control": "no-store" } });
}
