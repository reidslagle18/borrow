import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;

  const customers = await sql`SELECT * FROM customers WHERE id = ${id}`;
  if (customers.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rentals = await sql`
    SELECT r.*, i.brand, i.size, i.color, i.photo_url
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    WHERE r.customer_id = ${id}
    ORDER BY r.start_date DESC
  `;
  const spent = rentals
    .filter((r) => r.status === "active" || r.status === "completed")
    .reduce(
      (s, r) =>
        s +
        Number(r.rental_price) +
        (Number(r.cleaning_fee) || (r.damage_waiver ? 5 : 0)) +
        Number(r.late_fee),
      0
    );
  return NextResponse.json({ ...customers[0], rentals, spent });
}

export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const flag = b.flag === "vip" || b.flag === "problem" ? b.flag : null;
  const rows = await sql`
    UPDATE customers SET
      name = ${b.name.trim()},
      phone = ${b.phone || null},
      email = ${b.email || null},
      instagram = ${b.instagram || null},
      flag = ${flag},
      notes = ${b.notes || null}
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}
