import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT c.*, COUNT(r.id)::int AS rental_count
    FROM customers c
    LEFT JOIN rentals r ON r.customer_id = c.id AND r.status != 'cancelled'
    GROUP BY c.id
    ORDER BY c.name ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const rows = await sql`
    INSERT INTO customers (name, phone, email, instagram, notes)
    VALUES (${b.name.trim()}, ${b.phone || null}, ${b.email || null},
            ${b.instagram || null}, ${b.notes || null})
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
