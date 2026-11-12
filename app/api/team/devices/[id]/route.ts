import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { newSetupCode } from "@/lib/timeclock";

type Ctx = { params: Promise<{ id: string }> };

/** Deactivate/reactivate a device, or regenerate its setup code. Devices are
 *  never hard-deleted — deactivating revokes clocking from that device. */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { id } = await params;
  const did = Number(id);
  const b = await request.json().catch(() => ({}));

  if ("active" in b) {
    await sql`UPDATE clock_devices SET active = ${!!b.active} WHERE id = ${did}`;
    await logAudit(b.active ? "clock_device_enable" : "clock_device_disable", { entity: "clock_device", entityId: did }, admin);
  }
  if (b.regenerate) {
    const code = newSetupCode();
    await sql`UPDATE clock_devices SET setup_code = ${code}, code_expires_at = now() + interval '24 hours',
              token = NULL, registered_at = NULL WHERE id = ${did}`;
    await logAudit("clock_device_recode", { entity: "clock_device", entityId: did }, admin);
    return NextResponse.json({ ok: true, setup_code: code });
  }
  return NextResponse.json({ ok: true });
}
