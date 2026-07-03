import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { sweepPendingPayouts } from "@/lib/connect";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Pay a consignor everything they're owed in one action: releases all their
 * accrued (pending) payouts — 60% rental earnings + any replacement-value
 * payouts — to their Stripe connected account. Blocked (with a clear reason)
 * until they've finished direct-deposit onboarding.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const { id } = await ctx.params;

  const c = (
    await sql`SELECT id, name, stripe_account_id, payouts_enabled FROM consignors WHERE id = ${id}`
  )[0];
  if (!c) {
    return NextResponse.json({ error: "Consignor not found" }, { status: 404 });
  }
  if (!c.stripe_account_id || !c.payouts_enabled) {
    return NextResponse.json(
      {
        error:
          "This consignor hasn't finished direct-deposit setup yet — they can't be paid until they do.",
        code: "not_onboarded",
      },
      { status: 409 }
    );
  }

  const result = await sweepPendingPayouts(Number(id));
  return NextResponse.json({ ok: true, ...result });
}
