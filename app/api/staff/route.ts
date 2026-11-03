import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

// List staff logins (admin only). Never returns password hashes.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const rows = await sql`
    SELECT id, name, username, role, active, created_at, last_login_at
    FROM staff_users ORDER BY active DESC, name ASC
  `;
  return NextResponse.json(rows);
}

// Create a staff login (admin only).
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const b = (await request.json().catch(() => ({}))) as {
    name?: string;
    username?: string;
    password?: string;
    role?: string;
  };
  const name = (b.name || "").trim();
  const username = (b.username || "").trim();
  const password = b.password || "";
  const role = b.role === "admin" ? "admin" : "staff";
  if (!name || !username || password.length < 6) {
    return NextResponse.json(
      { error: "Name, username, and a password of at least 6 characters are required." },
      { status: 400 }
    );
  }
  const dupe = await sql`SELECT 1 FROM staff_users WHERE lower(username) = lower(${username})`;
  if (dupe.length) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
  }
  const hash = await hashPassword(password);
  const rows = await sql`
    INSERT INTO staff_users (name, username, password_hash, role)
    VALUES (${name}, ${username}, ${hash}, ${role})
    RETURNING id, name, username, role, active, created_at, last_login_at
  `;
  await logAudit("staff_create", { entity: "staff", entityId: rows[0].id, detail: { name, username, role } }, admin);
  return NextResponse.json(rows[0]);
}
