import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrCreateConnectedAccount, createOnboardingLink } from "@/lib/connect";

/**
 * Stable, never-expiring entry point for consignor payout onboarding.
 *
 * The welcome email links here (with the consignor's portal code) instead of a
 * raw Stripe Account Link. Stripe Account Links are single-use and expire a few
 * minutes after they're created, so embedding one in an email timed people out
 * the moment they opened it late. This mints a FRESH onboarding link on every
 * click and redirects to it, so the email works no matter when it's opened.
 *
 * Auth: the consignor's own portal code (their secret, from the email). This
 * route is exempt from the studio login gate (see proxy.ts /api/public/).
 */
const SHOP = (process.env.SHOP_URL || "https://borrowfayetteville.com").replace(/\/$/, "");

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const origin = url.origin;
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();

  // Anything we can't act on falls back to the portal, where they can sign in.
  const portalFallback = code
    ? `${SHOP}/portal?code=${encodeURIComponent(code)}`
    : `${SHOP}/portal`;

  if (!code || code.length < 6) return NextResponse.redirect(portalFallback);

  const rows = await sql`
    SELECT id, name, email, stripe_account_id, payouts_enabled, portal_code
    FROM consignors WHERE portal_code = ${code} LIMIT 1
  `;
  const c = rows[0];
  if (!c) return NextResponse.redirect(portalFallback);

  // Already set up — no need to onboard again; show them their hub.
  if (c.payouts_enabled) return NextResponse.redirect(portalFallback);

  const stripe = getStripe();
  if (!stripe) return NextResponse.redirect(portalFallback);

  try {
    const accountId = await getOrCreateConnectedAccount(stripe, c);
    const link = await createOnboardingLink(
      stripe,
      accountId,
      `${origin}/connect/return?status=done`,
      // Self-refresh: if the fresh link expires mid-flow, Stripe sends them
      // back here and we mint another one.
      `${origin}/api/public/connect-start?code=${encodeURIComponent(code)}`
    );
    return NextResponse.redirect(link);
  } catch {
    return NextResponse.redirect(portalFallback);
  }
}
