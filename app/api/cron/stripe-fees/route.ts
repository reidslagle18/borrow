import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { syncStripeFees } from "@/lib/stripe-fees";

/**
 * Daily job (Vercel Cron — see vercel.json) that records the actual Stripe
 * processing fee on each card transaction, so Finances can log Stripe Fees as an
 * expense automatically. Protected by CRON_SECRET when set.
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
  const res = await syncStripeFees(300);
  return NextResponse.json({ ok: true, ...res });
}
