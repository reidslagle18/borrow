import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Grant a customer store credit for posting a rented piece. Tied to a rental
 * so each rental can only earn the credit once (unique index enforces it).
 */
export async function POST(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.rental_id) {
    return NextResponse.json({ error: "rental_id is required" }, { status: 400 });
  }

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
