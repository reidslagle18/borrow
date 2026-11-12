import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { CLOCK_DEVICE_COOKIE, newDeviceToken } from "@/lib/timeclock";

/**
 * Register THIS device for clocking using the one-time setup code from admin.
 * Must be done by a signed-in user; mints a device token stored in a long-lived
 * cookie on this device. Codes expire in 24h and are consumed on use.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const b = await request.json().catch(() => ({}));
  const code = String(b.code || "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Enter the setup code." }, { status: 400 });

  const rows = await sql`
    SELECT id, name FROM clock_devices
    WHERE setup_code = ${code} AND active = true
      AND code_expires_at > now() AND registered_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) return NextResponse.json({ error: "That code is invalid or expired. Ask the owner for a new one." }, { status: 400 });

  const token = newDeviceToken();
  await sql`
    UPDATE clock_devices
    SET token = ${token}, registered_at = now(), setup_code = NULL, last_seen_at = now()
    WHERE id = ${rows[0].id}
  `;

  const res = NextResponse.json({ ok: true, device_name: rows[0].name });
  res.cookies.set(CLOCK_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
