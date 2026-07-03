import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrCreateConnectedAccount, createOnboardingLink } from "@/lib/connect";
import { sendConsignorWelcome } from "@/lib/email";

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT c.*,
      (SELECT COUNT(*)::int FROM items i WHERE i.consignor_id = c.id) AS piece_count,
      (SELECT COUNT(*)::int FROM items i WHERE i.consignor_id = c.id AND i.status != 'retired') AS active_piece_count,
      (SELECT COALESCE(SUM(r.rental_price), 0)
         FROM rentals r JOIN items i ON i.id = r.item_id
        WHERE i.consignor_id = c.id AND r.status = 'completed') AS completed_revenue,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payouts p
        WHERE p.consignor_id = c.id AND p.status != 'pending') AS paid,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payouts p
        WHERE p.consignor_id = c.id AND p.status = 'pending') AS owed
    FROM consignors c
    ORDER BY c.name ASC
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

  // Create their Stripe Connect account + a fresh onboarding link up front, so
  // the welcome can invite them to set up direct deposit right away.
  let onboardingUrl: string | null = null;
  const stripe = getStripe();
  if (stripe) {
    try {
      const accountId = await getOrCreateConnectedAccount(stripe, consignor);
      consignor.stripe_account_id = accountId;
      const base = process.env.PORTAL_URL || "https://borrow-shop.vercel.app/portal";
      onboardingUrl = await createOnboardingLink(
        stripe,
        accountId,
        `${base}?deposit=done`,
        `${base}?deposit=refresh`
      );
    } catch (err) {
      console.error("[consignors] Connect setup failed:", (err as Error).message);
    }
  }

  // Optional welcome invite: portal magic link + the onboarding link.
  let welcomeSent = false;
  if (b.send_welcome && consignor.email) {
    const r = await sendConsignorWelcome({
      to: consignor.email,
      consignorName: consignor.name,
      portalCode: consignor.portal_code ?? null,
      onboardingUrl,
    });
    welcomeSent = r.sent;
    console.log(`[consignors] welcome to ${consignor.email}:`, JSON.stringify(r));
  }

  return NextResponse.json(
    { ...consignor, onboarding_url: onboardingUrl, welcome_sent: welcomeSent },
    { status: 201 }
  );
}
