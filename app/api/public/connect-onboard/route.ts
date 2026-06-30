import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrCreateConnectedAccount, createOnboardingLink } from "@/lib/connect";

/**
 * Consignor-facing onboarding link, called from the shop's consignor portal.
 * Auth mirrors the portal feed: the shop's server key (x-api-key) plus the
 * consignor's own email+phone (or access code). The shop passes return_url /
 * refresh_url back to its own portal page.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();

  const b = await request.json();
  const email = (b.email || "").trim().toLowerCase();
  const digits = (b.phone || "").replace(/\D/g, "");
  const code = (b.code || "").trim().toUpperCase();

  let consignors;
  if (email && digits.length >= 7) {
    consignors = await sql`
      SELECT id, name, email, stripe_account_id, payouts_enabled FROM consignors
      WHERE lower(email) = ${email}
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits}
      LIMIT 1
    `;
  } else if (code && code.length >= 6) {
    consignors = await sql`
      SELECT id, name, email, stripe_account_id, payouts_enabled FROM consignors
      WHERE portal_code = ${code} LIMIT 1
    `;
  } else {
    return NextResponse.json({ error: "Enter your email and phone number" }, { status: 400 });
  }
  if (!consignors || consignors.length === 0) {
    return NextResponse.json({ error: "No consignor matches — check with BORROW" }, { status: 404 });
  }

  const accountId = await getOrCreateConnectedAccount(stripe, consignors[0]);
  const returnUrl = typeof b.return_url === "string" ? b.return_url : "";
  const refreshUrl = typeof b.refresh_url === "string" ? b.refresh_url : returnUrl;
  if (!returnUrl) {
    return NextResponse.json({ error: "return_url required" }, { status: 400 });
  }
  const url = await createOnboardingLink(stripe, accountId, returnUrl, refreshUrl);
  return NextResponse.json({ url });
}
