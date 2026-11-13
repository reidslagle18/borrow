import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser } from "@/lib/team";

type Ctx = { params: Promise<{ id: string }> };

/** Requester cancels their own coverage request (while still open/claimed). */
export async function POST(request: Request, { params }: Ctx) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const { id } = await params;
  const cid = Number(id);
  const rows = await sql`
    UPDATE coverage_requests SET status = 'cancelled', updated_at = now()
    WHERE id = ${cid} AND requester_member_id = ${member.id} AND status IN ('open','claimed')
    RETURNING id
  `;
  if (!rows.length) return NextResponse.json({ error: "Couldn't cancel — it may already be approved." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
