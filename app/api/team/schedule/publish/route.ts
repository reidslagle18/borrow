import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { mondayOf, weekDates, weekLabel, createNotification, prettyRange } from "@/lib/team";
import { fmtWeekday } from "@/lib/dates";
import { sendSchedulePublished } from "@/lib/email";

/**
 * POST /api/team/schedule/publish — publish or unpublish a week.
 * Body: { week: YYYY-MM-DD, publish: boolean }
 * Publishing notifies every staffer who has a shift that week (in-app + email).
 */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const weekStart = mondayOf(String(b.week || "").slice(0, 10) || new Date().toISOString().slice(0, 10));
  const publish = b.publish !== false;
  const dates = weekDates(weekStart);
  const weekEnd = dates[5];

  if (!publish) {
    await sql`
      INSERT INTO schedule_weeks (week_start, status, updated_at)
      VALUES (${weekStart}, 'draft', now())
      ON CONFLICT (week_start) DO UPDATE SET status = 'draft', published_at = NULL, updated_at = now()
    `;
    await logAudit("schedule_unpublish", { entity: "schedule_week", entityId: weekStart }, admin);
    return NextResponse.json({ ok: true, status: "draft" });
  }

  await sql`
    INSERT INTO schedule_weeks (week_start, status, published_at, updated_at)
    VALUES (${weekStart}, 'published', now(), now())
    ON CONFLICT (week_start) DO UPDATE SET status = 'published', published_at = now(), updated_at = now()
  `;

  // Gather each member's shifts this week for their notification + email.
  const rows = await sql`
    SELECT s.team_member_id AS mid, tm.name, tm.email,
           to_char(s.shift_date,'YYYY-MM-DD') AS d, s.start_time, s.end_time, s.is_training
    FROM shifts s JOIN team_members tm ON tm.id = s.team_member_id
    WHERE s.shift_date >= ${weekStart} AND s.shift_date <= ${weekEnd} AND s.team_member_id IS NOT NULL
    ORDER BY s.shift_date ASC
  `;
  const byMember = new Map<number, { name: string; email: string | null; shifts: { date: string; time: string; training?: boolean }[] }>();
  for (const r of rows as { mid: number; name: string; email: string | null; d: string; start_time: string; end_time: string; is_training: boolean }[]) {
    if (!byMember.has(r.mid)) byMember.set(r.mid, { name: r.name, email: r.email, shifts: [] });
    byMember.get(r.mid)!.shifts.push({
      date: `${fmtWeekday(r.d)}`,
      time: prettyRange(r.start_time, r.end_time),
      training: r.is_training,
    });
  }

  let notified = 0;
  for (const [mid, info] of byMember) {
    await createNotification({
      memberId: mid,
      kind: "schedule_published",
      title: `Schedule posted — ${weekLabel(weekStart)}`,
      body: `You have ${info.shifts.length} shift${info.shifts.length === 1 ? "" : "s"} this week.`,
      link: "/my-shifts",
    });
    if (info.email) {
      try {
        await sendSchedulePublished({ to: info.email, name: info.name, weekLabel: weekLabel(weekStart), shifts: info.shifts });
        notified++;
      } catch {
        /* non-fatal */
      }
    }
  }

  await logAudit("schedule_publish", { entity: "schedule_week", entityId: weekStart, detail: { notified } }, admin);
  return NextResponse.json({ ok: true, status: "published", notified });
}
