import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import {
  SESSION_COOKIE,
  VIEWAS_COOKIE,
  adminToken,
  staffToken,
} from "@/lib/session";
import { verifyPassword } from "@/lib/auth";

function sessionCookie() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
    username?: string;
  };
  const password = typeof body.password === "string" ? body.password : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";

  // Owner master login — password only, must equal APP_PASSWORD (unchanged from
  // the original single-password scheme, so an existing owner session keeps
  // working and the owner needs no staff row).
  if (!username) {
    if (process.env.APP_PASSWORD && password === process.env.APP_PASSWORD) {
      const res = NextResponse.json({ ok: true, role: "admin" });
      res.cookies.set(SESSION_COOKIE, await adminToken(), sessionCookie());
      res.cookies.set(VIEWAS_COOKIE, "", { ...sessionCookie(), maxAge: 0 });
      return res;
    }
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  // Staff login — username + password against the staff_users table.
  await ensureSchema();
  const rows = await sql`
    SELECT id, password_hash, active, role
    FROM staff_users WHERE lower(username) = lower(${username})
  `;
  const u = rows[0];
  if (!u || u.active === false || !(await verifyPassword(password, u.password_hash))) {
    return NextResponse.json(
      { error: "Incorrect username or password" },
      { status: 401 }
    );
  }
  await sql`UPDATE staff_users SET last_login_at = now() WHERE id = ${u.id}`;
  const res = NextResponse.json({ ok: true, role: u.role === "admin" ? "admin" : "staff" });
  res.cookies.set(SESSION_COOKIE, await staffToken(Number(u.id)), sessionCookie());
  res.cookies.set(VIEWAS_COOKIE, "", { ...sessionCookie(), maxAge: 0 });
  return res;
}
