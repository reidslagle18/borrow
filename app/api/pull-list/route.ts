import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { lastSafeRentalLeadDays } from "@/lib/types";

/**
 * The "pull for reservation" schedule: everything that needs to come off the
 * browsable rack into holding, with its Last Safe Rental Date (LSRD) and days
 * remaining. days_remaining <= 0 means pull it now. Two kinds:
 *   • kind 'rental'    — a customer's confirmed upcoming reservation
 *   • kind 'consignor' — a consignor asked for their own piece back (a self-hold
 *                        retrieval); staff still have to pull it off the rack.
 */
export async function GET() {
  await ensureSchema();
  const program = await getProgram();
  const lead = lastSafeRentalLeadDays(program);

  const [rentals, consignor] = await Promise.all([
    sql`
      SELECT r.id AS rental_id, NULL::int AS request_id, i.id, i.barcode,
             COALESCE(NULLIF(i.name, ''), i.brand) AS item_label, i.photo_url, i.status,
             to_char(r.start_date, 'YYYY-MM-DD') AS reservation_date,
             cu.name AS customer_name,
             to_char(r.start_date - ${lead}::int, 'YYYY-MM-DD') AS last_safe_date,
             ((r.start_date - ${lead}::int) - (now() AT TIME ZONE 'America/Chicago')::date)::int AS days_remaining,
             (r.pulled_at IS NOT NULL) AS pulled,
             NULL::text AS note, 'rental' AS kind
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.status = 'reserved' AND r.start_date >= (now() AT TIME ZONE 'America/Chicago')::date
    `,
    sql`
      SELECT NULL::int AS rental_id, rr.id AS request_id, i.id, i.barcode,
             COALESCE(NULLIF(i.name, ''), i.brand) AS item_label, i.photo_url, i.status,
             to_char(rr.hold_start, 'YYYY-MM-DD') AS reservation_date,
             c.name AS customer_name,
             to_char(rr.hold_start - ${lead}::int, 'YYYY-MM-DD') AS last_safe_date,
             ((rr.hold_start - ${lead}::int) - (now() AT TIME ZONE 'America/Chicago')::date)::int AS days_remaining,
             (rr.pulled_at IS NOT NULL) AS pulled,
             rr.note, 'consignor' AS kind
      FROM retrieval_requests rr
      JOIN items i ON i.id = rr.item_id
      JOIN consignors c ON c.id = rr.consignor_id
      WHERE rr.status = 'open' AND rr.hold_start IS NOT NULL
        AND rr.hold_start >= (now() AT TIME ZONE 'America/Chicago')::date
    `,
  ]);

  const rows = [...rentals, ...consignor].sort((a, b) =>
    String(a.last_safe_date).localeCompare(String(b.last_safe_date)) ||
    String(a.reservation_date).localeCompare(String(b.reservation_date))
  );
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/** Mark a consignor retrieval pulled / un-pulled (rentals use /api/rentals/[id]). */
export async function PATCH(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const id = Number(b.request_id);
  if (!id) {
    return NextResponse.json({ error: "request_id is required" }, { status: 400 });
  }
  if (b.pulled) {
    await sql`UPDATE retrieval_requests SET pulled_at = now() WHERE id = ${id}`;
  } else {
    await sql`UPDATE retrieval_requests SET pulled_at = NULL WHERE id = ${id}`;
  }
  return NextResponse.json({ ok: true });
}
