import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Account login: email + phone must both match the same customer.
 * Customers the studio created by hand (no token yet) get one minted on
 * their first login, so imported signups can log straight in.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json();
  const email = (b.email || "").trim().toLowerCase();
  const digits = (b.phone || "").replace(/\D/g, "");

  if (!email || digits.length < 7) {
    return NextResponse.json(
      { error: "Enter your email and phone number" },
      { status: 400 }
    );
  }

  const rows = await sql`
    SELECT * FROM customers
    WHERE lower(email) = ${email}
      AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No account matches that email and phone — try signing up" },
      { status: 404 }
    );
  }

  let row = rows[0];
  if (!row.account_token) {
    const updated = await sql`
      UPDATE customers SET
        account_token = substr(md5(random()::text) || md5(random()::text), 1, 48),
        account_created_at = COALESCE(account_created_at, now())
      WHERE id = ${row.id}
      RETURNING *
    `;
    row = updated[0];
  }

  return NextResponse.json({
    token: row.account_token,
    name: row.name,
    email: row.email,
    phone: row.phone,
  });
}
