import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** Log a post for an ambassador (counts toward this month's target). */
export async function POST(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  const rows = await sql`
    INSERT INTO ambassador_posts (ambassador_id, posted_on, link, note)
    VALUES (
      ${id}, ${b.posted_on || null}, ${b.link?.trim() || null}, ${b.note?.trim() || null}
    )
    RETURNING *
  `;
  return NextResponse.json(rows[0], { status: 201 });
}

export async function DELETE(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  if (!b.post_id) {
    return NextResponse.json({ error: "post_id required" }, { status: 400 });
  }
  const rows = await sql`
    DELETE FROM ambassador_posts
    WHERE id = ${b.post_id} AND ambassador_id = ${id}
    RETURNING id
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
