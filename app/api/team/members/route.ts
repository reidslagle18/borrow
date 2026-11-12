import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { newIcalToken } from "@/lib/team";

/** Team members (admin only) — the HR/scheduling records for front-desk staff. */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const rows = await sql`
    SELECT tm.id, tm.staff_user_id, tm.name, tm.phone, tm.email,
           to_char(tm.start_date, 'YYYY-MM-DD') AS start_date,
           tm.active, tm.emergency_name, tm.emergency_phone,
           tm.max_shifts_per_week, tm.onboarding, tm.sms_opt_in, tm.notes,
           su.username AS login_username, su.active AS login_active
    FROM team_members tm
    LEFT JOIN staff_users su ON su.id = tm.staff_user_id
    ORDER BY tm.active DESC, tm.name ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

  const rows = await sql`
    INSERT INTO team_members
      (name, phone, email, start_date, emergency_name, emergency_phone,
       max_shifts_per_week, notes, ical_token)
    VALUES (${name}, ${b.phone || null}, ${b.email || null},
            ${b.start_date || null}, ${b.emergency_name || null}, ${b.emergency_phone || null},
            ${b.max_shifts_per_week ?? null}, ${b.notes || null}, ${newIcalToken()})
    RETURNING id, name
  `;
  await logAudit(
    "team_member_create",
    { entity: "team_member", entityId: rows[0].id, detail: { name } },
    admin
  );
  return NextResponse.json(rows[0], { status: 201 });
}
