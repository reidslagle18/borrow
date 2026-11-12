import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getPayConfig, periodForDate } from "@/lib/timeclock";

/**
 * POST /api/team/timesheets/close — lock or reopen a pay period.
 * Body: { period_start, close: boolean, reason? }  (reason required to reopen)
 * A closed period can only be changed afterward with a reason (enforced on edits).
 */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const cfg = await getPayConfig();
  const period = periodForDate(String(b.period_start || "").slice(0, 10), cfg);
  const close = b.close !== false;

  if (close) {
    await sql`
      INSERT INTO pay_period_closures (period_start, period_end, closed_by, reopened_at)
      VALUES (${period.start}, ${period.end}, ${admin.name}, NULL)
      ON CONFLICT (period_start) DO UPDATE SET period_end = EXCLUDED.period_end,
        closed_at = now(), closed_by = EXCLUDED.closed_by, reopened_at = NULL
    `;
    await logAudit("pay_period_close", { entity: "pay_period", entityId: period.start }, admin);
    return NextResponse.json({ ok: true, closed: true });
  }

  const reason = String(b.reason || "").trim();
  if (!reason) return NextResponse.json({ error: "A reason is required to reopen a closed period." }, { status: 400 });
  await sql`UPDATE pay_period_closures SET reopened_at = now() WHERE period_start = ${period.start}`;
  await logAudit("pay_period_reopen", { entity: "pay_period", entityId: period.start, detail: { reason } }, admin);
  return NextResponse.json({ ok: true, closed: false });
}
