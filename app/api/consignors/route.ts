import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { CONSIGNOR_SHARE } from "@/lib/types";

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT c.*,
      (SELECT COUNT(*)::int FROM items i WHERE i.consignor_id = c.id) AS piece_count,
      (SELECT COUNT(*)::int FROM items i WHERE i.consignor_id = c.id AND i.status != 'retired') AS active_piece_count,
      (SELECT COALESCE(SUM(r.rental_price), 0)
         FROM rentals r JOIN items i ON i.id = r.item_id
        WHERE i.consignor_id = c.id AND r.status = 'completed') AS completed_revenue,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payouts p
        WHERE p.consignor_id = c.id AND p.status != 'pending') AS paid
    FROM consignors c
    ORDER BY c.name ASC
  `;
  const enriched = rows.map((r) => {
    const earned =
      Math.round(Number(r.completed_revenue) * CONSIGNOR_SHARE * 100) / 100;
    const paid = Number(r.paid);
    return { ...r, earned, paid, owed: Math.max(0, earned - paid) };
  });
  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const rows = await sql`
    INSERT INTO consignors (name, email, phone, notes, venmo, payout_backup, portal_code)
    VALUES (${b.name.trim()}, ${b.email || null}, ${b.phone || null}, ${b.notes || null},
            ${b.venmo || null}, ${b.payout_backup || null},
            upper(substr(md5(random()::text), 1, 8)))
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
