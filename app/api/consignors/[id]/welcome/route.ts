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
export async function POST(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const c = (
    await sql`SELECT id, name, email, portal_code, stripe_account_id, payouts_enabled FROM consignors WHERE id = ${id}`
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
  const stripe = getStripe();
  if (stripe && !c.payouts_enabled) {
    try {
      const accountId = await getOrCreateConnectedAccount(stripe, c);
      const base = process.env.PORTAL_URL || "https://borrow-shop.vercel.app/portal";
      onboardingUrl = await createOnboardingLink(
        stripe,
        accountId,
        `${base}?deposit=done`,
        `${base}?deposit=refresh`
      );
    } catch (err) {
      console.error("[welcome] Connect link failed:", (err as Error).message);
    }
  }

  const r = await sendConsignorWelcome({
    to: c.email,
    consignorName: c.name,
    portalCode: c.portal_code ?? null,
    onboardingUrl,
  });
  return NextResponse.json({ sent: r.sent, error: r.error });
}
