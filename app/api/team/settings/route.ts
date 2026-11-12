import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getTeamSettings, saveTeamSettings, DEFAULT_TEAM_SETTINGS, type TeamSettings } from "@/lib/team";

export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  return NextResponse.json(await getTeamSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  // SMS can only actually turn on once the sending number is approved — enforce
  // that invariant server-side so it can't be toggled on prematurely.
  const sms_from_approved = !!b.sms_from_approved;
  const cur = await getTeamSettings();
  const freq = ["weekly", "biweekly", "semimonthly"].includes(b.pay_period_frequency)
    ? b.pay_period_frequency
    : cur.pay_period_frequency;
  const next: TeamSettings = {
    ...DEFAULT_TEAM_SETTINGS,
    ...cur,
    sms_from_approved,
    sms_enabled: sms_from_approved ? !!b.sms_enabled : false,
    owner_sms: typeof b.owner_sms === "string" ? b.owner_sms : cur.owner_sms,
    pay_period_frequency: freq,
    pay_period_anchor:
      typeof b.pay_period_anchor === "string" && b.pay_period_anchor
        ? b.pay_period_anchor.slice(0, 10)
        : cur.pay_period_anchor,
  };
  await saveTeamSettings(next);
  await logAudit("team_settings_save", { entity: "team_settings", detail: { sms_enabled: next.sms_enabled } }, admin);
  return NextResponse.json(next);
}
