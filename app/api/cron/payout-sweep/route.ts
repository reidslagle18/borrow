import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { sweepPendingPayouts } from "@/lib/connect";

/**
 * Automatic payout sweep: sends every consignor's owed (pending) balance to
 * their bank via Stripe. Runs on a schedule (see vercel.json) as a safety net —
 * payouts also send instantly when a rental completes and when a consignor
 * finishes onboarding, so this just catches anything that couldn't send yet
 * (e.g. earned before onboarding, or a transient transfer failure).
 * Protected by CRON_SECRET when set (Vercel Cron sends it as a Bearer token).
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
