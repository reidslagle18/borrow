import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * The "Sync to e.closet" checklist: Borrow-origin bookings (online / in-store)
 * on pieces that are ALSO listed on e.closet, which staff still need to go mark
 * unavailable on e.closet so the same physical dress can't be double-booked
 * there. e.closet-origin rentals (source='ecloset') are excluded — those came
 * FROM e.closet. Marked done via POST once blocked on their side.
 */
export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT r.id AS rental_id, i.id AS item_id, i.barcode,
           COALESCE(NULLIF(i.name,''), i.brand) AS item_label, i.photo_url,
           r.status,
           to_char(r.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(r.due_date, 'YYYY-MM-DD') AS due_date,
           cu.name AS customer_name,
           (r.ecloset_synced_at IS NOT NULL) AS synced
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers cu ON cu.id = r.customer_id
    WHERE i.listed_on_ecloset = true
      AND r.source <> 'ecloset'
      AND r.status IN ('reserved','active')
      AND r.due_date >= (now() AT TIME ZONE 'America/Chicago')::date
    ORDER BY (r.ecloset_synced_at IS NOT NULL), r.start_date ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/** Mark a booking blocked-on-e.closet (or undo). */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const id = Number(b.rental_id);
  if (!id) return NextResponse.json({ error: "rental_id required" }, { status: 400 });
  if (b.synced === false) {
    await sql`UPDATE rentals SET ecloset_synced_at = NULL WHERE id = ${id}`;
  } else {
    await sql`UPDATE rentals SET ecloset_synced_at = now() WHERE id = ${id}`;
  }
  return NextResponse.json({ ok: true });
}
