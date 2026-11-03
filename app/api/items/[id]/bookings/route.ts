import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Read-only: a piece (by id OR barcode) plus its reserved/active bookings, for
 * the barcode-lookup calendar. No mutations — viewing only.
 */
export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;

  const items = await sql`
    SELECT id, barcode, COALESCE(NULLIF(name, ''), brand) AS name, brand, size,
           color, photo_url, status, turnaround_override
    FROM items WHERE id = ${id} OR barcode = ${id}
    LIMIT 1
  `;
  if (items.length === 0) {
    return NextResponse.json({ error: "No piece with that barcode." }, { status: 404 });
  }
  const item = items[0];

  const bookings = await sql`
    SELECT r.id, r.status,
           to_char(r.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(r.due_date, 'YYYY-MM-DD') AS due_date,
           cu.name AS customer_name
    FROM rentals r
    LEFT JOIN customers cu ON cu.id = r.customer_id
    WHERE r.item_id = ${item.id} AND r.status IN ('reserved', 'active')
    ORDER BY r.start_date
  `;

  // A per-piece override (e.g. 0 for same-day turnaround) wins over the global default.
  const buffer =
    item.turnaround_override != null
      ? Number(item.turnaround_override)
      : Number((await getProgram()).turnaround_days) || 0;
  return NextResponse.json({ item, bookings, buffer });
}
