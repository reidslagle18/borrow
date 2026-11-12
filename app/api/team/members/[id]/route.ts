import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { newIcalToken } from "@/lib/team";

type Ctx = { params: Promise<{ id: string }> };

/** Update one team member: contact fields, active flag, onboarding checklist,
 *  max-shifts, emergency contact, linked staff login. Deactivating keeps history. */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  const mid = Number(id);
  const b = await request.json().catch(() => ({}));

  const exists = await sql`SELECT id FROM team_members WHERE id = ${mid}`;
  if (!exists[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Each field updated with its own explicit statement (neon tagged templates
  // can't parameterize column names). Only touched when present in the body.
  if (typeof b.name === "string" && b.name.trim())
    await sql`UPDATE team_members SET name = ${b.name.trim()}, updated_at = now() WHERE id = ${mid}`;
  if ("phone" in b)
    await sql`UPDATE team_members SET phone = ${b.phone || null}, updated_at = now() WHERE id = ${mid}`;
  if ("email" in b)
    await sql`UPDATE team_members SET email = ${b.email || null}, updated_at = now() WHERE id = ${mid}`;
  if ("start_date" in b)
    await sql`UPDATE team_members SET start_date = ${b.start_date || null}, updated_at = now() WHERE id = ${mid}`;
  if ("emergency_name" in b)
    await sql`UPDATE team_members SET emergency_name = ${b.emergency_name || null}, updated_at = now() WHERE id = ${mid}`;
  if ("emergency_phone" in b)
    await sql`UPDATE team_members SET emergency_phone = ${b.emergency_phone || null}, updated_at = now() WHERE id = ${mid}`;
  if ("max_shifts_per_week" in b)
    await sql`UPDATE team_members SET max_shifts_per_week = ${b.max_shifts_per_week ?? null}, updated_at = now() WHERE id = ${mid}`;
  if ("notes" in b)
    await sql`UPDATE team_members SET notes = ${b.notes || null}, updated_at = now() WHERE id = ${mid}`;
  if ("sms_opt_in" in b)
    await sql`UPDATE team_members SET sms_opt_in = ${!!b.sms_opt_in}, updated_at = now() WHERE id = ${mid}`;
  if ("staff_user_id" in b && (typeof b.staff_user_id === "number" || b.staff_user_id === null))
    await sql`UPDATE team_members SET staff_user_id = ${b.staff_user_id}, updated_at = now() WHERE id = ${mid}`;

  if ("active" in b) {
    await sql`UPDATE team_members SET active = ${!!b.active}, updated_at = now() WHERE id = ${mid}`;
    await logAudit(b.active ? "team_member_activate" : "team_member_deactivate",
      { entity: "team_member", entityId: mid }, admin);
  }

  // Onboarding checklist: merge partial updates into the JSONB object.
  if (b.onboarding && typeof b.onboarding === "object") {
    const cur = await sql`SELECT onboarding FROM team_members WHERE id = ${mid}`;
    const merged = { ...(cur[0]?.onboarding || {}), ...b.onboarding };
    await sql`UPDATE team_members SET onboarding = ${JSON.stringify(merged)}::jsonb, updated_at = now() WHERE id = ${mid}`;
  }

  if (b.regenerate_ical)
    await sql`UPDATE team_members SET ical_token = ${newIcalToken()}, updated_at = now() WHERE id = ${mid}`;

  const rows = await sql`
    SELECT tm.id, tm.staff_user_id, tm.name, tm.phone, tm.email,
           to_char(tm.start_date, 'YYYY-MM-DD') AS start_date,
           tm.active, tm.emergency_name, tm.emergency_phone,
           tm.max_shifts_per_week, tm.onboarding, tm.sms_opt_in, tm.notes, tm.ical_token
    FROM team_members tm WHERE tm.id = ${mid}
  `;
  await logAudit("team_member_update", { entity: "team_member", entityId: mid }, admin);
  return NextResponse.json(rows[0]);
}
