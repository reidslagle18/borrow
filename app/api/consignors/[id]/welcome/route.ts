import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrCreateConnectedAccount } from "@/lib/connect";
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
    await sql`SELECT id, name, email, stripe_account_id, payouts_enabled, portal_code, consignor_rate FROM consignors WHERE id = ${id}`
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

  // Ensure their connected account exists, then link the welcome to the STABLE
  // onboarding endpoint (mints a fresh Stripe link on click — never expires).
  const origin = new URL(request.url).origin;
  const stripe = getStripe();
  if (stripe && !c.payouts_enabled) {
    try {
      await getOrCreateConnectedAccount(stripe, c);
    } catch (err) {
      console.error("[welcome] Connect setup failed:", (err as Error).message);
    }
  }
  const onboardingUrl = c.portal_code
    ? `${origin}/api/public/connect-start?code=${encodeURIComponent(c.portal_code)}`
    : null;

  const r = await sendConsignorWelcome({
    to: c.email,
    consignorName: c.name,
    onboardingUrl,
    rate: c.consignor_rate ?? undefined,
  });
  if (r.sent) {
    await sql`UPDATE consignors SET welcome_sent_at = now() WHERE id = ${id}`;
  }
  return NextResponse.json({ sent: r.sent, error: r.error });
}
