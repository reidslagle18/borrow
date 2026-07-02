import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Curated "Recommended" order for the shop — an ordered list of item ids stored
 * in app_settings. The public availability feed shows these first, in this
 * order; anything not listed falls back to newest-available-first.
 */
export async function GET() {
  await ensureSchema();
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'recommended_order'`;
  const order = Array.isArray(rows[0]?.value) ? (rows[0].value as string[]) : [];
  return NextResponse.json({ order });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const b = await request.json();
  const order = Array.isArray(b.order)
    ? Array.from(new Set(b.order.map((x: unknown) => String(x)).filter(Boolean)))
    : [];
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('recommended_order', ${JSON.stringify(order)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return NextResponse.json({ order });
}
