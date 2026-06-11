import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { CONSIGNOR_SHARE } from "@/lib/types";

/**
 * Consignor self-service portal feed for the customer site.
 * Auth is two-layer: the shop's server key (x-api-key) plus the
 * consignor's personal access code. Customer names are never included.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSchema();
  const b = await request.json();
  const code = (b.code || "").trim().toUpperCase();
  if (!code || code.length < 6) {
    return NextResponse.json({ error: "Enter your access code" }, { status: 400 });
  }

  const consignors = await sql`
    SELECT id, name, phone, email FROM consignors WHERE portal_code = ${code}
  `;
  if (consignors.length === 0) {
    return NextResponse.json(
      { error: "That code doesn't match — double-check with BORROW" },
      { status: 404 }
    );
  }
  const c = consignors[0];

  const items = await sql`
    SELECT i.id, i.brand, i.size, i.color, i.tier, i.rental_price,
           i.photo_url, i.status, i.rental_count,
      (SELECT COALESCE(SUM(r.rental_price), 0) FROM rentals r
        WHERE r.item_id = i.id AND r.status = 'completed') AS revenue,
      COALESCE(
        (SELECT json_agg(json_build_object('start_date', r.start_date, 'due_date', r.due_date)
                         ORDER BY r.start_date)
           FROM rentals r
          WHERE r.item_id = i.id AND r.status IN ('reserved','active')
            AND r.due_date >= CURRENT_DATE),
        '[]'
      ) AS booked
    FROM items i
    WHERE i.consignor_id = ${c.id}
    ORDER BY i.created_at DESC
  `;
  const payouts = await sql`
    SELECT amount, method, paid_at FROM payouts
    WHERE consignor_id = ${c.id}
    ORDER BY paid_at DESC, id DESC
  `;

  const revenue = items.reduce((s, i) => s + Number(i.revenue), 0);
  const earned = Math.round(revenue * CONSIGNOR_SHARE * 100) / 100;
  const paid = payouts.reduce((s, p) => s + Number(p.amount), 0);

  return NextResponse.json({
    name: c.name,
    items: items.map((i) => ({
      ...i,
      earned: Math.round(Number(i.revenue) * CONSIGNOR_SHARE * 100) / 100,
    })),
    payouts,
    earned,
    paid,
    owed: Math.max(0, earned - paid),
  });
}
