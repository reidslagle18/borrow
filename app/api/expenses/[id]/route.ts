import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const CATEGORIES = [
  "cleaning",
  "stripe_fees",
  "rent",
  "marketing",
  "supplies",
  "loan_interest",
  "other",
];

/** Edit a manual expense entry. Auto (cleaning/stripe) entries aren't editable. */
export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json().catch(() => ({}));
  const category = String(b.category || "");
  const amount = Math.round(Number(b.amount) * 100) / 100;
  const incurredOn = String(b.incurred_on || "");
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Pick a valid category." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than 0." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)) {
    return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
  }
  const rows = await sql`
    UPDATE expense_log
    SET incurred_on = ${incurredOn}, category = ${category}, amount = ${amount},
        note = ${b.note?.toString().trim() || null}
    WHERE id = ${Number(id)}
    RETURNING id
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/** Delete a manual expense entry. */
export async function DELETE(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  await sql`DELETE FROM expense_log WHERE id = ${Number(id)}`;
  return NextResponse.json({ ok: true });
}
