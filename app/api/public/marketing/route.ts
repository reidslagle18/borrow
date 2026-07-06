import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

function authorized(request: Request): boolean {
  const key = request.headers.get("x-api-key");
  return !!process.env.BOOKING_API_KEY && key === process.env.BOOKING_API_KEY;
}

/**
 * Marketing opt-in from the shop popup. Writes to the SAME customers table used
 * everywhere else: matches an existing customer by email/phone and updates them
 * (no duplicate list), or creates one. Records the email-list join time and,
 * when a phone + consent are given, the SMS consent timestamp.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json();
  const name = (b.name || "").trim();
  const email = (b.email || "").trim().toLowerCase();
  const phone = (b.phone || "").trim();
  const digits = phone.replace(/\D/g, "");
  const smsConsent = !!b.sms_consent;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A real email is required." }, { status: 400 });
  }
  if (digits.length > 0 && digits.length < 7) {
    return NextResponse.json({ error: "That phone number looks off." }, { status: 400 });
  }
  if (digits.length >= 7 && !smsConsent) {
    return NextResponse.json(
      { error: "Please agree to the texting terms to include your number." },
      { status: 400 }
    );
  }

  const existing = await sql`
    SELECT id FROM customers
    WHERE lower(email) = ${email}
       OR (${digits}::text <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits})
    ORDER BY (lower(email) = ${email}) DESC
    LIMIT 1
  `;

  // Only stamp SMS consent when a phone is actually provided with consent.
  const stampSms = digits.length >= 7 && smsConsent;

  let id: number;
  if (existing.length > 0) {
    id = Number(existing[0].id);
    await sql`
      UPDATE customers SET
        name = COALESCE(NULLIF(name, ''), ${name || null}),
        email = COALESCE(NULLIF(email, ''), ${email}),
        phone = COALESCE(NULLIF(phone, ''), ${phone || null}),
        marketing_signup_at = COALESCE(marketing_signup_at, now())
      WHERE id = ${id}
    `;
  } else {
    const rows = await sql`
      INSERT INTO customers (name, email, phone, marketing_signup_at)
      VALUES (${name || null}, ${email}, ${phone || null}, now())
      RETURNING id
    `;
    id = Number(rows[0].id);
  }
  // Keep the earliest consent timestamp we recorded.
  if (stampSms) {
    await sql`UPDATE customers SET sms_consent_at = COALESCE(sms_consent_at, now()) WHERE id = ${id}`;
  }

  return NextResponse.json({ ok: true });
}
