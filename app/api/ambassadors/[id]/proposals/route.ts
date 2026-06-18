import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { ensureCurrentPeriod } from "@/lib/credits";

type Ctx = { params: Promise<{ id: string }> };

/** Add a proposed piece for a Curator. */
export async function POST(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.description?.trim()) {
    return NextResponse.json(
      { error: "Describe the proposed piece" },
      { status: 400 }
    );
  }
  const rows = await sql`
    INSERT INTO ambassador_proposals (ambassador_id, description, accepted)
    VALUES (${id}, ${b.description.trim()}, ${!!b.accepted})
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}

/** Toggle whether BORROW accepted a proposed piece. */
export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.proposal_id) {
    return NextResponse.json({ error: "proposal_id required" }, { status: 400 });
  }
  const existing = await sql`
    SELECT accepted FROM ambassador_proposals
    WHERE id = ${b.proposal_id} AND ambassador_id = ${id}
  `;
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const was = existing[0].accepted;
  const now = !!b.accepted;
  const rows = await sql`
    UPDATE ambassador_proposals
    SET accepted = ${now}
    WHERE id = ${b.proposal_id} AND ambassador_id = ${id}
    RETURNING *
  `;

  // Curator bonus: +1 free credit when a proposed piece is accepted; remove it
  // if un-accepted. Only meaningful for curators (who have proposals).
  if (was !== now) {
    const ambRows = await sql`SELECT * FROM ambassadors WHERE id = ${id}`;
    if (ambRows.length > 0 && ambRows[0].tier === "curator") {
      await ensureCurrentPeriod(ambRows[0]);
      if (now) {
        await sql`UPDATE ambassadors SET bonus_earned = bonus_earned + 1 WHERE id = ${id}`;
      } else {
        await sql`UPDATE ambassadors SET bonus_earned = GREATEST(bonus_earned - 1, 0) WHERE id = ${id}`;
      }
    }
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.proposal_id) {
    return NextResponse.json({ error: "proposal_id required" }, { status: 400 });
  }
  const rows = await sql`
    DELETE FROM ambassador_proposals
    WHERE id = ${b.proposal_id} AND ambassador_id = ${id}
    RETURNING id
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
