import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendConsignorRecoveryNotice } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Record money a consignor owes back (e.g. a payout sent in error). It's then
 * withheld automatically from their future payouts (see payoutForCompletedRental)
 * until fully recovered. Optionally emails the consignor a heads-up.
 */
export async function POST(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json().catch(() => ({}));
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: "A positive amount is required." }, { status: 400 });
  }
  const c = await sql`SELECT id, name, email FROM consignors WHERE id = ${id}`;
  if (!c.length) return NextResponse.json({ error: "Consignor not found." }, { status: 404 });

  const rows = await sql`
    INSERT INTO consignor_recoveries (consignor_id, amount, note)
    VALUES (${id}, ${amount}, ${b.note || null})
    RETURNING *`;

  let emailed = false;
  if (b.email !== false && c[0].email) {
    const res = await sendConsignorRecoveryNotice({
      to: c[0].email,
      consignorName: c[0].name ?? "",
      brand: b.brand || "a piece",
      amount,
    });
    emailed = res.sent;
  }
  return NextResponse.json({ ok: true, recovery: rows[0], emailed });
}
