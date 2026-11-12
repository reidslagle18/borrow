import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/**
 * GET /api/team/time-off — all time-off requests (admin). Each row includes any
 * already-assigned shifts that fall inside the range, so the owner can find
 * coverage before approving.
 */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const rows = await sql`
    SELECT t.id, t.team_member_id, tm.name AS member_name,
           to_char(t.start_date,'YYYY-MM-DD') AS start_date,
           to_char(t.end_date,'YYYY-MM-DD') AS end_date,
           t.note, t.status, t.decided_note,
           to_char(t.decided_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS decided_at,
           to_char(t.created_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
           (SELECT COUNT(*) FROM shifts s
             WHERE s.team_member_id = t.team_member_id
               AND s.shift_date >= t.start_date AND s.shift_date <= t.end_date)::int
             AS assigned_shift_conflicts
    FROM time_off t JOIN team_members tm ON tm.id = t.team_member_id
    ORDER BY (t.status = 'pending') DESC, t.start_date DESC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
