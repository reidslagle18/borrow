import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Public: record that a shopper opened a piece on the customer site. Increments
 * items.click_count, which drives the shop's default "Most loved" sort. Keyed by
 * BOOKING_API_KEY (the shop proxy sends it). Best-effort — never blocks the page.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const id = typeof b.item_id === "string" ? b.item_id.trim() : "";
  if (!id) return NextResponse.json({ error: "item_id required" }, { status: 400 });
  await sql`UPDATE items SET click_count = COALESCE(click_count, 0) + 1 WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
