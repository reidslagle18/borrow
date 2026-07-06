import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { availableSlots } from "@/lib/dropoff";

/**
 * Admin: with ?date=YYYY-MM-DD, returns open slots for that day (used by the
 * reschedule picker). Otherwise returns booked appointments (upcoming first).
 */
export async function GET(request: Request) {
  await ensureSchema();
  const date = new URL(request.url).searchParams.get("date");
  if (date) {
    return NextResponse.json({ slots: await availableSlots(date) });
  }
  const rows = await sql`
    SELECT a.*,
           cu.name AS customer_name,
           co.name AS consignor_name
    FROM drop_off_appointments a
    LEFT JOIN customers cu ON cu.id = a.customer_id
    LEFT JOIN consignors co ON co.id = a.consignor_id
    WHERE a.status = 'booked'
    ORDER BY a.slot_date ASC, a.slot_time ASC
  `;
  return NextResponse.json(rows);
}
