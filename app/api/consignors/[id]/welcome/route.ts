import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrCreateConnectedAccount, createOnboardingLink } from "@/lib/connect";
import { sendConsignorWelcome } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

/**
 * (Re)send a consignor's welcome: their portal magic link + a fresh Stripe
 * direct-deposit onboarding link. Also ensures their connected account exists.
 */
export async function POST(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const c = (
    await sql`SELECT id, name, email, stripe_account_id, payouts_enabled FROM consignors WHERE id = ${id}`
  )[0];
  if (!c) {
    return NextResponse.json({ error: "Consignor not found" }, { status: 404 });
  }
  if (!c.email) {
    return NextResponse.json(
      { error: "Add an email for this consignor first." },
      { status: 400 }
    );
  }

  let onboardingUrl: string | null = null;
  const origin = new URL(request.url).origin;
  const stripe = getStripe();
  if (stripe && !c.payouts_enabled) {
    try {
      const accountId = await getOrCreateConnectedAccount(stripe, c);
      onboardingUrl = await createOnboardingLink(
        stripe,
        accountId,
        `${origin}/connect/return?status=done`,
        `${origin}/connect/return?status=refresh`
      );
    } catch (err) {
      console.error("[welcome] Connect link failed:", (err as Error).message);
    }
  }

  const r = await sendConsignorWelcome({
    to: c.email,
    consignorName: c.name,
    onboardingUrl,
  });
  if (r.sent) {
    await sql`UPDATE consignors SET welcome_sent_at = now() WHERE id = ${id}`;
  }
  return NextResponse.json({ sent: r.sent, error: r.error });
}
