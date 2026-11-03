import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { consignorShare } from "@/lib/types";

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

  // Payouts accrue as ledger rows: 'pending' = owed (rental 60% + replacement),
  // anything else = already sent. Owed-now is the sum of pending rows.
  const paid = payouts
    .filter((p) => p.status !== "pending")
    .reduce((s, p) => s + Number(p.amount), 0);
  const owed = payouts
    .filter((p) => p.status === "pending")
    .reduce((s, p) => s + Number(p.amount), 0);
  const charged = charges.reduce((s, c) => s + Number(c.amount), 0);

  // Why this consignor is at their rate: the earlier of their first drop-off
  // booking or their signing determined it (item 7 — admin visibility).
  const c0 = consignors[0];
  const apptRows = await sql`
    SELECT to_char(MIN(created_at), 'YYYY-MM-DD') AS first_booking
    FROM drop_off_appointments a
    WHERE a.consignor_id = ${id}
       OR (COALESCE(${c0.email}, '') <> '' AND lower(a.email) = lower(${c0.email}))
  `;
  const firstBooking: string | null = apptRows[0]?.first_booking ?? null;
  const signedAt: string | null = c0.agreement_signed_at
    ? new Date(c0.agreement_signed_at).toISOString().slice(0, 10)
    : null;
  let rateBasis: string;
  let rateBasisDate: string | null;
  if (firstBooking && (!signedAt || firstBooking <= signedAt)) {
    rateBasis = "appointment booking";
    rateBasisDate = firstBooking;
  } else if (signedAt) {
    rateBasis = "agreement signing";
    rateBasisDate = signedAt;
  } else if (firstBooking) {
    rateBasis = "appointment booking";
    rateBasisDate = firstBooking;
  } else {
    rateBasis = "new default";
    rateBasisDate = null;
  }

  const share = consignorShare(c0.consignor_rate);
  return NextResponse.json({
    ...consignors[0],
    rate: Math.round(share * 100),
    rate_basis: rateBasis,
    rate_basis_date: rateBasisDate,
    rate_locked: c0.consignor_rate != null,
    items: items.map((i) => ({
      ...i,
      earned: Math.round(Number(i.revenue) * share * 100) / 100,
    })),
    payouts,
    charges,
    earned: Math.round((owed + paid) * 100) / 100, // total credited to date
    paid,
    owed,
    cleaning_charges: charged,
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
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
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
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
