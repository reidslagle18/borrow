import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrCreateConnectedAccount } from "@/lib/connect";
import { sendConsignorWelcome } from "@/lib/email";

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT c.*,
      (SELECT COUNT(*)::int FROM items i WHERE i.consignor_id = c.id) AS piece_count,
      (SELECT COUNT(*)::int FROM items i WHERE i.consignor_id = c.id AND i.status != 'retired') AS active_piece_count,
      (SELECT COUNT(*)::int FROM items i WHERE i.consignor_id = c.id AND i.approval_status IN ('pending','disputed')) AS pending_approvals,
      (SELECT COALESCE(SUM(r.rental_price), 0)
         FROM rentals r JOIN items i ON i.id = r.item_id
        WHERE i.consignor_id = c.id AND r.status = 'completed') AS completed_revenue,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payouts p
        WHERE p.consignor_id = c.id AND p.status != 'pending') AS paid,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payouts p
        WHERE p.consignor_id = c.id AND p.status = 'pending') AS owed
    FROM consignors c
    ORDER BY c.created_at DESC, c.id DESC
  `;
  const enriched = rows.map((r) => {
    const paid = Number(r.paid);
    const owed = Number(r.owed);
    return { ...r, earned: Math.round((owed + paid) * 100) / 100, paid, owed };
  });
  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const rows = await sql`
    INSERT INTO consignors (name, email, phone, notes, portal_code)
    VALUES (${b.name.trim()}, ${b.email || null}, ${b.phone || null}, ${b.notes || null},
            upper(substr(md5(random()::text), 1, 8)))
    RETURNING *
  `;
  const consignor = rows[0];

  // Create their Express connected account (receive-only) up front so it's
  // ready. The welcome email links to a STABLE endpoint (below) that mints a
  // fresh Stripe onboarding link on click — never an Account Link embedded here,
  // since those expire within minutes and timed people out.
  const origin = new URL(request.url).origin;
  const stripe = getStripe();
  if (stripe) {
    try {
      const accountId = await getOrCreateConnectedAccount(stripe, consignor);
      consignor.stripe_account_id = accountId;
    } catch (err) {
      console.error("[consignors] Connect setup failed:", (err as Error).message);
    }
  }
  const onboardingUrl = consignor.portal_code
    ? `${origin}/api/public/connect-start?code=${encodeURIComponent(consignor.portal_code)}`
    : null;

  // Do NOT send the setup email automatically. Sending is always a deliberate
  // click ("Send setup email" on the consignor's card) so nothing goes out to
  // someone who booked but hasn't actually shown up yet. A caller can still
  // opt in explicitly by passing send_welcome: true.
  let welcomeSent = false;
  if (b.send_welcome === true && consignor.email) {
    const r = await sendConsignorWelcome({
      to: consignor.email,
      consignorName: consignor.name,
      onboardingUrl,
    });
    welcomeSent = r.sent;
    if (r.sent) {
      await sql`UPDATE consignors SET welcome_sent_at = now() WHERE id = ${consignor.id}`;
      consignor.welcome_sent_at = new Date().toISOString();
    }
    console.log(`[consignors] welcome to ${consignor.email}:`, JSON.stringify(r));
  }

  return NextResponse.json(
    { ...consignor, onboarding_url: onboardingUrl, welcome_sent: welcomeSent },
    { status: 201 }
  );
}
