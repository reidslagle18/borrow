import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;

  const rows = await sql`
    SELECT a.*, c.name AS customer_name, cons.name AS consignor_name
    FROM ambassadors a
    LEFT JOIN customers c ON c.id = a.customer_id
    LEFT JOIN consignors cons ON cons.id = a.consignor_id
    WHERE a.id = ${id}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sourced = await sql`
    SELECT id, brand, barcode, size, color, status, photo_url, rental_count
    FROM items WHERE ambassador_id = ${id}
    ORDER BY created_at DESC
  `;
  const proposals = await sql`
    SELECT * FROM ambassador_proposals
    WHERE ambassador_id = ${id}
    ORDER BY id ASC
  `;
  return NextResponse.json({ ...rows[0], sourced_items: sourced, proposals });
}

export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();

  // Action: auto-create + link a consignor record from this ambassador's info.
  if (b.action === "create_consignor") {
    const a = await sql`SELECT * FROM ambassadors WHERE id = ${id}`;
    if (a.length === 0)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (a[0].consignor_id) {
      return NextResponse.json(
        { error: "A consignor record is already linked" },
        { status: 400 }
      );
    }
    const cons = await sql`
      INSERT INTO consignors (name, phone, notes, portal_code)
      VALUES (${a[0].name}, ${a[0].phone || null}, 'Ambassador',
              upper(substr(md5(random()::text), 1, 8)))
      RETURNING *
    `;
    const updated = await sql`
      UPDATE ambassadors SET consignor_id = ${cons[0].id} WHERE id = ${id}
      RETURNING *
    `;
    return NextResponse.json(updated[0]);
  }

  if (!b.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const tier = b.tier === "curator" ? "curator" : "poster";
  const status = b.status === "inactive" ? "inactive" : "active";
  const months: string[] = Array.isArray(b.active_months) ? b.active_months : [];

  try {
    const rows = await sql`
      UPDATE ambassadors SET
        name = ${b.name.trim()},
        instagram = ${b.instagram || null},
        phone = ${b.phone || null},
        sorority = ${b.sorority || null},
        tier = ${tier},
        status = ${status},
        join_date = ${b.join_date || null},
        referral_code = ${b.referral_code?.trim() || null},
        active_months = ${months},
        customer_id = ${b.customer_id ?? null},
        consignor_id = ${b.consignor_id ?? null},
        notes = ${b.notes || null}
      WHERE id = ${id}
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
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

export async function DELETE(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  // Detach sourced pieces first so they aren't blocked by the reference.
  await sql`UPDATE items SET ambassador_id = NULL WHERE ambassador_id = ${id}`;
  const rows = await sql`DELETE FROM ambassadors WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
