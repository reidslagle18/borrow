import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

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
  const rows = await sql`
    UPDATE ambassador_proposals
    SET accepted = ${!!b.accepted}
    WHERE id = ${b.proposal_id} AND ambassador_id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
