import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { mondayOf, weekDates, DEFAULT_START, DEFAULT_END } from "@/lib/team";

/** The repeating weekly template (default assignment per weekday Mon=1…Sat=6). */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const rows = await sql`
    SELECT weekday, team_member_id, start_time, end_time, is_training, enabled
    FROM schedule_template ORDER BY weekday ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

/** Replace the full template. Body: { rows: [{weekday, team_member_id, start_time, end_time, is_training, enabled}] } */
export async function PUT(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const rows = Array.isArray(b.rows) ? b.rows : [];
  for (const r of rows) {
    const wd = Number(r.weekday);
    if (wd < 1 || wd > 6) continue;
    await sql`
      INSERT INTO schedule_template (weekday, team_member_id, start_time, end_time, is_training, enabled)
      VALUES (${wd}, ${r.team_member_id ?? null}, ${r.start_time || DEFAULT_START},
              ${r.end_time || DEFAULT_END}, ${!!r.is_training}, ${r.enabled !== false})
      ON CONFLICT (weekday) DO UPDATE SET
        team_member_id = EXCLUDED.team_member_id, start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time, is_training = EXCLUDED.is_training, enabled = EXCLUDED.enabled
    `;
  }
  await logAudit("schedule_template_save", { entity: "schedule_template" }, admin);
  return NextResponse.json({ ok: true });
}

/** POST — stamp the template onto a week. Body: { week } */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const week = mondayOf(String(b.week || "").slice(0, 10) || new Date().toISOString().slice(0, 10));
  const dates = weekDates(week);
  const tmpl = await sql`SELECT weekday, team_member_id, start_time, end_time, is_training, enabled FROM schedule_template`;
  let applied = 0;
  for (const t of tmpl as { weekday: number; team_member_id: number | null; start_time: string; end_time: string; is_training: boolean; enabled: boolean }[]) {
    if (!t.enabled) continue;
    const date = dates[t.weekday - 1]; // Mon=1 → index 0
    if (!date) continue;
    await sql`
      INSERT INTO shifts (shift_date, start_time, end_time, team_member_id, is_training)
      VALUES (${date}, ${t.start_time}, ${t.end_time}, ${t.team_member_id}, ${t.is_training})
      ON CONFLICT (shift_date) DO UPDATE SET
        start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
        team_member_id = EXCLUDED.team_member_id, is_training = EXCLUDED.is_training,
        reminder_sent = false, updated_at = now()
    `;
    applied++;
  }
  await sql`INSERT INTO schedule_weeks (week_start) VALUES (${week}) ON CONFLICT (week_start) DO NOTHING`;
  await logAudit("schedule_template_apply", { entity: "schedule_week", entityId: week, detail: { applied } }, admin);
  return NextResponse.json({ ok: true, applied });
}
