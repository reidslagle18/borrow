import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getProgram } from "@/lib/credits";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Grant a customer store credit. Two modes:
 *  - Post credit: { rental_id } → the fixed post_credit, once per rental
 *    (unique index enforces it).
 *  - Manual grant: { amount, note } → an arbitrary amount the owner grants
 *    (e.g. a giveaway), with a free-text label. Logged in the ledger.
 * Both bump the customer's running balance and add a ledger entry.
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();

  // Manual grant path: an explicit amount (no rental_id).
  if (!b.rental_id) {
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!(amount > 0)) {
      return NextResponse.json(
        { error: "Enter a positive credit amount." },
        { status: 400 }
      );
    }
    const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
    await sql`
      INSERT INTO store_credit_entries (customer_id, amount, reason, note)
      VALUES (${id}, ${amount}, 'grant', ${note})
    `;
    const rows = await sql`
      UPDATE customers SET store_credit = store_credit + ${amount}
      WHERE id = ${id}
      RETURNING store_credit
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, store_credit: Number(rows[0].store_credit) });
  }

  // Post-credit path: fixed amount, once per rental.
  const amount = (await getProgram()).post_credit;
  try {
    await sql`
      INSERT INTO store_credit_entries (customer_id, amount, reason, rental_id)
      VALUES (${id}, ${amount}, 'post', ${b.rental_id})
    `;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "This rental already earned a post credit" },
        { status: 409 }
      );
    }
    throw err;
  }
  const rows = await sql`
    UPDATE customers SET store_credit = store_credit + ${amount}
    WHERE id = ${id}
    RETURNING store_credit
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, store_credit: Number(rows[0].store_credit) });
}
