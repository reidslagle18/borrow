import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrCreateConnectedAccount, createOnboardingLink } from "@/lib/connect";

/**
 * Admin: get a Stripe Connect onboarding link for a consignor so staff can send
 * it to them (or open it on the consignor's behalf). Creates the connected
 * account on first use.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  if (!b.consignor_id) {
    return NextResponse.json({ error: "consignor_id required" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, name, email, stripe_account_id, payouts_enabled
    FROM consignors WHERE id = ${b.consignor_id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Consignor not found" }, { status: 404 });
  }

  const accountId = await getOrCreateConnectedAccount(stripe, rows[0]);
  const origin = new URL(request.url).origin;
  const url = await createOnboardingLink(
    stripe,
    accountId,
    `${origin}/consignors?connect=done&c=${b.consignor_id}`,
    `${origin}/consignors?connect=refresh&c=${b.consignor_id}`
  );
  return NextResponse.json({ url });
}
