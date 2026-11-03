import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

// Update a staff login (admin only): enable/disable in one click, rename, change
// role, or reset their password.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const { id } = await params;
  const staffId = Number(id);
  if (!Number.isInteger(staffId)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const b = (await request.json().catch(() => ({}))) as {
    active?: boolean;
    name?: string;
    role?: string;
    password?: string;
  };

  const exists = await sql`SELECT id FROM staff_users WHERE id = ${staffId}`;
  if (!exists.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (typeof b.active === "boolean") {
    await sql`UPDATE staff_users SET active = ${b.active} WHERE id = ${staffId}`;
    await logAudit(b.active ? "staff_enable" : "staff_disable", { entity: "staff", entityId: staffId }, admin);
  }
  if (typeof b.name === "string" && b.name.trim()) {
    await sql`UPDATE staff_users SET name = ${b.name.trim()} WHERE id = ${staffId}`;
  }
  if (b.role === "admin" || b.role === "staff") {
    await sql`UPDATE staff_users SET role = ${b.role} WHERE id = ${staffId}`;
    await logAudit("staff_role", { entity: "staff", entityId: staffId, detail: { role: b.role } }, admin);
  }
  if (typeof b.password === "string") {
    if (b.password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }
    await sql`UPDATE staff_users SET password_hash = ${await hashPassword(b.password)} WHERE id = ${staffId}`;
    await logAudit("staff_password_reset", { entity: "staff", entityId: staffId }, admin);
  }

  const rows = await sql`
    SELECT id, name, username, role, active, created_at, last_login_at
    FROM staff_users WHERE id = ${staffId}
  `;
  return NextResponse.json(rows[0]);
}
