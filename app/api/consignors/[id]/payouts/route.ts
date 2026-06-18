import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendPayoutNotice } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();

  const amount = Number(b.amount);
  if (!amount || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be greater than zero" },
      { status: 400 }
    );
  }
  const exists = await sql`SELECT id, name, email FROM consignors WHERE id = ${id}`;
  if (exists.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sql`
    INSERT INTO payouts (consignor_id, amount, method, notes, paid_at)
    VALUES (${id}, ${amount}, ${b.method || null}, ${b.notes || null},
            ${b.paid_at || new Date().toISOString().slice(0, 10)})
    RETURNING *
  `;

  // Notify the consignor they've been paid (best-effort email).
  if (exists[0].email) {
    await sendPayoutNotice({
      to: exists[0].email,
      consignorName: exists[0].name ?? "",
      amount,
      method: b.method || null,
    });
  }
  return NextResponse.json(rows[0], { status: 201 });
}
