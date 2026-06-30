import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { sweepPendingPayouts } from "@/lib/connect";

/**
 * Daily payout sweep (Vercel Cron — see vercel.json). Retries auto-payouts that
 * are still pending because the platform's available balance hadn't settled
 * when the rental completed, or the consignor onboarded after earning. Skips
 * consignors who still can't receive payouts.
 *
 * Protected by CRON_SECRET when set (Bearer token from Vercel Cron).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  await ensureSchema();
  const result = await sweepPendingPayouts();
  return NextResponse.json({ ok: true, ...result });
}
