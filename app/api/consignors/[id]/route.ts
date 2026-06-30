import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { CONSIGNOR_SHARE } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;

  const consignors = await sql`SELECT * FROM consignors WHERE id = ${id}`;
  if (consignors.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const items = await sql`
    SELECT i.*,
      (SELECT COUNT(*)::int FROM rentals r WHERE r.item_id = i.id AND r.status = 'completed') AS completed_rentals,
      (SELECT COALESCE(SUM(r.rental_price), 0) FROM rentals r WHERE r.item_id = i.id AND r.status = 'completed') AS revenue
    FROM items i
    WHERE i.consignor_id = ${id}
    ORDER BY i.created_at DESC
  `;
  const payouts = await sql`
    SELECT * FROM payouts WHERE consignor_id = ${id}
    ORDER BY paid_at DESC, id DESC
  `;
  // Opt-in cleaning charges (retrieval / initial) deduct from earnings; cleaning
  // on rentals is never charged to the consignor.
  const charges = await sql`
    SELECT * FROM consignor_charges WHERE consignor_id = ${id}
    ORDER BY charged_on DESC, id DESC
  `;

  const revenue = items.reduce((s, i) => s + Number(i.revenue), 0);
  const earned = Math.round(revenue * CONSIGNOR_SHARE * 100) / 100;
  // Only money actually sent counts as paid; queued auto-payouts are still owed.
  const paid = payouts
    .filter((p) => p.status !== "pending")
    .reduce((s, p) => s + Number(p.amount), 0);
  const pendingPayouts = payouts
    .filter((p) => p.status === "pending")
    .reduce((s, p) => s + Number(p.amount), 0);
  const charged = charges.reduce((s, c) => s + Number(c.amount), 0);

  return NextResponse.json({
    ...consignors[0],
    items: items.map((i) => ({
      ...i,
      earned: Math.round(Number(i.revenue) * CONSIGNOR_SHARE * 100) / 100,
    })),
    payouts,
    charges,
    earned,
    paid,
    pending_payouts: pendingPayouts,
    cleaning_charges: charged,
    owed: Math.max(0, earned - charged - paid),
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const rows = await sql`
    UPDATE consignors SET
      name = ${b.name.trim()},
      email = ${b.email || null},
      phone = ${b.phone || null},
      notes = ${b.notes || null},
      venmo = ${b.venmo || null},
      payout_backup = ${b.payout_backup || null}
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;

  const items = await sql`SELECT COUNT(*)::int n FROM items WHERE consignor_id = ${id}`;
  if (items[0].n > 0) {
    return NextResponse.json(
      {
        error: `This consignor still has ${items[0].n} piece(s). Remove or reassign their pieces first.`,
      },
      { status: 400 }
    );
  }
  // Detach any ambassador linked to this consignor; payouts & cleaning charges
  // cascade automatically.
  await sql`UPDATE ambassadors SET consignor_id = NULL WHERE consignor_id = ${id}`;
  const del = await sql`DELETE FROM consignors WHERE id = ${id} RETURNING id`;
  if (del.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
