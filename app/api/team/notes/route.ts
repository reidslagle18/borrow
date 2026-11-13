import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/** GET — the shift-notes feed (admin). Non-archived, newest first. */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const rows = await sql`
    SELECT sn.id, to_char(sn.shift_date,'YYYY-MM-DD') AS shift_date, sn.body, sn.needs_attention,
           tm.name AS member_name,
           to_char(sn.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
    FROM shift_notes sn LEFT JOIN team_members tm ON tm.id = sn.member_id
    WHERE sn.archived_at IS NULL
    ORDER BY sn.created_at DESC LIMIT 200
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
