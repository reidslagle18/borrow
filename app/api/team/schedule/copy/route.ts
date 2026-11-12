import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { mondayOf, weekDates } from "@/lib/team";
import { addDays } from "@/lib/dates";

/**
 * POST /api/team/schedule/copy — copy the prior week's assignments into `week`.
 * Body: { week: YYYY-MM-DD, from?: YYYY-MM-DD }  (from defaults to week − 7 days)
 * Overwrites the target week's shifts; the target stays a draft.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const target = mondayOf(String(b.week || "").slice(0, 10) || new Date().toISOString().slice(0, 10));
  const source = b.from ? mondayOf(String(b.from).slice(0, 10)) : addDays(target, -7);

  const sourceDates = weekDates(source);
  const targetDates = weekDates(target);
  const src = await sql`
    SELECT to_char(shift_date,'YYYY-MM-DD') AS d, start_time, end_time, team_member_id, is_training, note
    FROM shifts WHERE shift_date >= ${sourceDates[0]} AND shift_date <= ${sourceDates[5]}
  `;
  const byWeekday = new Map<number, { start_time: string; end_time: string; team_member_id: number | null; is_training: boolean; note: string | null }>();
  for (const r of src as { d: string; start_time: string; end_time: string; team_member_id: number | null; is_training: boolean; note: string | null }[]) {
    const idx = sourceDates.indexOf(r.d);
    if (idx >= 0) byWeekday.set(idx, r);
  }

  let copied = 0;
  for (let i = 0; i < 6; i++) {
    const row = byWeekday.get(i);
    const date = targetDates[i];
    if (!row) continue;
    await sql`
      INSERT INTO shifts (shift_date, start_time, end_time, team_member_id, is_training, note)
      VALUES (${date}, ${row.start_time}, ${row.end_time}, ${row.team_member_id}, ${row.is_training}, ${row.note})
      ON CONFLICT (shift_date) DO UPDATE SET
        start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
        team_member_id = EXCLUDED.team_member_id, is_training = EXCLUDED.is_training,
        note = EXCLUDED.note, reminder_sent = false, updated_at = now()
    `;
    copied++;
  }
  await sql`INSERT INTO schedule_weeks (week_start) VALUES (${target}) ON CONFLICT (week_start) DO NOTHING`;
  await logAudit("schedule_copy", { entity: "schedule_week", entityId: target, detail: { source, copied } }, admin);
  return NextResponse.json({ ok: true, copied });
}
