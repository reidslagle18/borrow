import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

function authorized(request: Request): boolean {
  const key = request.headers.get("x-api-key");
  return !!process.env.BOOKING_API_KEY && key === process.env.BOOKING_API_KEY;
}

/**
 * Self-serve account signup from the customer site.
 * Matches an existing customer by email or phone (so people the studio
 * already knows just claim their record) or creates a fresh one, then
 * mints an account token.
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

  if (!name || !email || !email.includes("@") || digits.length < 7) {
    return NextResponse.json(
      { error: "Name, a real email and a real phone number are required" },
      { status: 400 }
    );
  }

  const existing = await sql`
    SELECT * FROM customers
    WHERE lower(email) = ${email}
       OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits}
    ORDER BY (lower(email) = ${email}) DESC
    LIMIT 1
  `;

  if (existing.length > 0 && existing[0].account_token) {
    return NextResponse.json(
      { error: "You already have an account — just log in" },
      { status: 409 }
    );
  }

  let row;
  if (existing.length > 0) {
    const rows = await sql`
      UPDATE customers SET
        name = COALESCE(NULLIF(name, ''), ${name}),
        email = ${email},
        phone = ${phone},
        account_token = substr(md5(random()::text) || md5(random()::text), 1, 48),
        account_created_at = now()
      WHERE id = ${existing[0].id}
      RETURNING id, name, email, phone, account_token
    `;
    row = rows[0];
  } else {
    const rows = await sql`
      INSERT INTO customers (name, email, phone, account_token, account_created_at)
      VALUES (${name}, ${email}, ${phone},
              substr(md5(random()::text) || md5(random()::text), 1, 48), now())
      RETURNING id, name, email, phone, account_token
    `;
    row = rows[0];
  }

  return NextResponse.json(
    { token: row.account_token, name: row.name, email: row.email, phone: row.phone },
    { status: 201 }
  );
}
