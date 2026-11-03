import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

// A logged-in staff member changes their own password.
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The owner authenticates with the APP_PASSWORD env var, which the app can't
  // rewrite — direct them to change it in the environment instead.
  if (s.userId == null) {
    return NextResponse.json(
      { error: "The owner password is set by APP_PASSWORD and can't be changed here." },
      { status: 400 }
    );
  }

  const b = (await request.json().catch(() => ({}))) as {
    current?: string;
    next?: string;
  };
  const current = b.current || "";
  const next = b.next || "";
  if (next.length < 6) {
    return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
  }
  await ensureSchema();
  const rows = await sql`SELECT password_hash FROM staff_users WHERE id = ${s.userId}`;
  if (!rows.length || !(await verifyPassword(current, rows[0].password_hash))) {
    return NextResponse.json({ error: "Your current password doesn't match." }, { status: 403 });
  }
  await sql`UPDATE staff_users SET password_hash = ${await hashPassword(next)} WHERE id = ${s.userId}`;
  await logAudit("self_password_change", { entity: "staff", entityId: s.userId }, s);
  return NextResponse.json({ ok: true });
}
