import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { newSetupCode } from "@/lib/timeclock";

/** Registered clock devices (admin). The setup_code is shown so the owner can
 *  type it into the device once; it expires in 24h and is consumed on register. */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const rows = await sql`
    SELECT id, name, active,
           CASE WHEN registered_at IS NOT NULL THEN true ELSE false END AS registered,
           to_char(registered_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS registered_at,
           to_char(last_seen_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_seen_at,
           CASE WHEN registered_at IS NULL AND code_expires_at > now() THEN setup_code ELSE NULL END AS setup_code,
           to_char(code_expires_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS code_expires_at
    FROM clock_devices ORDER BY active DESC, created_at DESC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/** Create a device slot and issue a one-time setup code. */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const name = String(b.name || "").trim() || "Store iPad";
  const code = newSetupCode();
  const rows = await sql`
    INSERT INTO clock_devices (name, setup_code, code_expires_at)
    VALUES (${name}, ${code}, now() + interval '24 hours')
    RETURNING id, name
  `;
  await logAudit("clock_device_create", { entity: "clock_device", entityId: rows[0].id, detail: { name } }, admin);
  return NextResponse.json({ id: rows[0].id, name, setup_code: code }, { status: 201 });
}
