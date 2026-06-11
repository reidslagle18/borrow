import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT c.*, COUNT(i.id)::int AS piece_count
    FROM consignors c
    LEFT JOIN items i ON i.consignor_id = c.id
    GROUP BY c.id
    ORDER BY c.name ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json();
  if (!b.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const rows = await sql`
    INSERT INTO consignors (name, email, phone, notes)
    VALUES (${b.name}, ${b.email || null}, ${b.phone || null}, ${b.notes || null})
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
