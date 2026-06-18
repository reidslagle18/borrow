import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/** 8-char uppercase referral code, e.g. "K3F9QZ2A". */
function genReferralCode(): string {
  return (
    Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6)
  )
    .toUpperCase()
    .padEnd(8, "0");
}

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT a.*,
      c.name AS customer_name,
      cons.name AS consignor_name,
      (SELECT COUNT(*)::int FROM items i WHERE i.ambassador_id = a.id) AS sourced_count,
      (SELECT COUNT(*)::int FROM ambassador_proposals p WHERE p.ambassador_id = a.id) AS proposal_count
    FROM ambassadors a
    LEFT JOIN customers c ON c.id = a.customer_id
    LEFT JOIN consignors cons ON cons.id = a.consignor_id
    ORDER BY a.status ASC, a.name ASC
  `;
  return NextResponse.json(rows);
}

/** Auto-create or reuse a customer record so the ambassador can also rent. */
async function linkCustomer(b: {
  name: string;
  phone?: string;
  email?: string;
  instagram?: string;
}): Promise<number> {
  const digits = (b.phone || "").replace(/\D/g, "");
  if (digits) {
    const existing = await sql`
      SELECT id FROM customers
      WHERE lower(name) = ${b.name.toLowerCase()}
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits}
      LIMIT 1
    `;
    if (existing.length > 0) return existing[0].id;
  }
  const created = await sql`
    INSERT INTO customers (name, phone, email, instagram)
    VALUES (${b.name}, ${b.phone || null}, ${b.email || null}, ${b.instagram || null})
    RETURNING id
  `;
  return created[0].id;
}

export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const name = b.name.trim();
  const tier = b.tier === "curator" ? "curator" : "poster";
  const status = b.status === "inactive" ? "inactive" : "active";
  const months: string[] = Array.isArray(b.active_months) ? b.active_months : [];

  const customerId = await linkCustomer({
    name,
    phone: b.phone,
    email: b.email,
    instagram: b.instagram,
  });

  const code = b.referral_code?.trim() || genReferralCode();

  try {
    const rows = await sql`
      INSERT INTO ambassadors (
        name, instagram, phone, sorority, tier, status, join_date,
        referral_code, active_months, customer_id, notes
      ) VALUES (
        ${name}, ${b.instagram || null}, ${b.phone || null}, ${b.sorority || null},
        ${tier}, ${status}, ${b.join_date || null},
        ${code}, ${months}, ${customerId}, ${b.notes || null}
      )
      RETURNING *
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "That referral code is already in use" },
        { status: 409 }
      );
    }
    throw err;
  }
}
