import { NextResponse } from "next/server";

/**
 * Payouts are now manual — the owner releases a consignor's owed balance with
 * one action in the studio, so there's no automatic daily sweep. This endpoint
 * is kept as a harmless no-op (and removed from vercel.json crons).
 */
export async function GET() {
  return NextResponse.json({ ok: true, note: "manual payouts — no sweep" });
}
