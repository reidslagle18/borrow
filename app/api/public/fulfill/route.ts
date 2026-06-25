import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { fulfillReservation } from "@/lib/bookings";

/**
 * Turns a paid Checkout Session into a reservation. Called by the customer
 * site's success page (and mirrored by the Stripe webhook). Idempotent.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json();
  if (!b.session_id) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }
  const result = await fulfillReservation(String(b.session_id));
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Couldn't confirm" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
