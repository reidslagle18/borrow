import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { CONSIGNOR_SHARE } from "@/lib/types";

/**
 * Full account view for a logged-in shopper: her own rentals, plus her
 * consignor dashboard if her email/phone matches a consignor the studio
 * has on file. Other customers' info is never included.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json();
  const token = (b.token || "").trim();
  if (token.length < 20) {
    return NextResponse.json({ error: "Log in again" }, { status: 401 });
  }

  const customers = await sql`
    SELECT * FROM customers WHERE account_token = ${token}
  `;
  if (customers.length === 0) {
    return NextResponse.json({ error: "Log in again" }, { status: 401 });
  }
  const me = customers[0];
  const email = (me.email || "").toLowerCase();
  const digits = (me.phone || "").replace(/\D/g, "");

  const rentals = await sql`
    SELECT r.id, r.start_date, r.due_date, r.returned_date, r.status,
           r.rental_price, r.damage_waiver, r.late_fee,
           i.brand, i.size, i.color, i.photo_url
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    WHERE r.customer_id = ${me.id} AND r.status != 'cancelled'
    ORDER BY r.start_date DESC
  `;

  // Consignor dashboard if she's also a consignor (matched on contact info)
  const consignors = await sql`
    SELECT id, name FROM consignors
    WHERE (${email} != '' AND lower(COALESCE(email, '')) = ${email})
       OR (${digits} != '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits})
    LIMIT 1
  `;

  let consignment = null;
  if (consignors.length > 0) {
    const cid = consignors[0].id;
    const items = await sql`
      SELECT i.id, i.brand, i.size, i.color, i.rental_price, i.photo_url,
             i.status, i.rental_count,
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
      WHERE i.consignor_id = ${cid}
      ORDER BY i.created_at DESC
    `;
    const payouts = await sql`
      SELECT amount, method, paid_at FROM payouts
      WHERE consignor_id = ${cid}
      ORDER BY paid_at DESC, id DESC
    `;
    const revenue = items.reduce((s, i) => s + Number(i.revenue), 0);
    const earned = Math.round(revenue * CONSIGNOR_SHARE * 100) / 100;
    const paid = payouts.reduce((s, p) => s + Number(p.amount), 0);
    consignment = {
      items: items.map((i) => ({
        ...i,
        earned: Math.round(Number(i.revenue) * CONSIGNOR_SHARE * 100) / 100,
      })),
      payouts,
      earned,
      paid,
      owed: Math.max(0, earned - paid),
    };
  }

  return NextResponse.json({
    name: me.name,
    email: me.email,
    phone: me.phone,
    rentals,
    consignment,
  });
}
