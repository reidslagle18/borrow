import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  mondayOf,
  weekDates,
  weekLabel,
  weekConflicts,
  createNotification,
  prettyRange,
  DEFAULT_START,
  DEFAULT_END,
  type ShiftRow,
} from "@/lib/team";
import { fmtWeekday } from "@/lib/dates";
import { sendScheduleChanged } from "@/lib/email";

/**
 * GET /api/team/schedule?week=YYYY-MM-DD  → full week detail for the scheduler.
 * GET /api/team/schedule?from=&to=        → lightweight shift list (month view).
 */
export async function GET(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && to) {
    const shifts = await sql`
      SELECT s.id, to_char(s.shift_date, 'YYYY-MM-DD') AS shift_date, s.start_time, s.end_time,
             s.team_member_id, s.is_training, tm.name AS member_name
      FROM shifts s LEFT JOIN team_members tm ON tm.id = s.team_member_id
      WHERE s.shift_date >= ${from} AND s.shift_date <= ${to}
      ORDER BY s.shift_date ASC
    `;
    const weeks = await sql`
      SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start, status
      FROM schedule_weeks WHERE week_start >= ${from} AND week_start <= ${to}
    `;
    return NextResponse.json({ shifts, weeks }, { headers: { "Cache-Control": "no-store" } });
  }

  const weekStart = mondayOf(url.searchParams.get("week") || new Date().toISOString().slice(0, 10));
  const dates = weekDates(weekStart);
  const weekEnd = dates[5];

  const [shiftsRaw, weekRow, members, avail, timeOff, oneOff] = await Promise.all([
    sql`SELECT id, to_char(shift_date, 'YYYY-MM-DD') AS shift_date, start_time, end_time,
               team_member_id, is_training, note
        FROM shifts WHERE shift_date >= ${weekStart} AND shift_date <= ${weekEnd}`,
    sql`SELECT status, to_char(published_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS published_at
        FROM schedule_weeks WHERE week_start = ${weekStart}`,
    sql`SELECT id, name, max_shifts_per_week FROM team_members WHERE active = true ORDER BY name ASC`,
    sql`SELECT team_member_id, weekday, available FROM availability`,
    sql`SELECT team_member_id, to_char(start_date,'YYYY-MM-DD') AS start_date,
               to_char(end_date,'YYYY-MM-DD') AS end_date, status
        FROM time_off WHERE status = 'approved' AND start_date <= ${weekEnd} AND end_date >= ${weekStart}`,
    sql`SELECT team_member_id, to_char(the_date,'YYYY-MM-DD') AS d FROM unavailable_dates
        WHERE the_date >= ${weekStart} AND the_date <= ${weekEnd}`,
  ]);

  const shifts = shiftsRaw as ShiftRow[];
  const conflicts = await weekConflicts(weekStart, shifts);

  // per-member shift count this week
  const counts: Record<number, number> = {};
  for (const s of shifts) if (s.team_member_id != null) counts[s.team_member_id] = (counts[s.team_member_id] ?? 0) + 1;

  return NextResponse.json(
    {
      week_start: weekStart,
      week_end: weekEnd,
      week_label: weekLabel(weekStart),
      dates,
      status: (weekRow[0]?.status as string) || "draft",
      published_at: weekRow[0]?.published_at || null,
      default_start: DEFAULT_START,
      default_end: DEFAULT_END,
      shifts,
      members,
      counts,
      conflicts,
      availability: avail,
      time_off: timeOff,
      unavailable: oneOff,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * PUT /api/team/schedule — upsert the single shift for a date.
 * Body: { date, team_member_id|null, start_time?, end_time?, is_training?, note? }
 * On a published week, affected staff get a change notification (in-app + email).
 */
export async function PUT(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const date = String(b.date || "").slice(0, 10);
  if (!date) return NextResponse.json({ error: "A date is required." }, { status: 400 });

  const weekStart = mondayOf(date);
  const start = b.start_time || DEFAULT_START;
  const end = b.end_time || DEFAULT_END;
  const member = b.team_member_id == null ? null : Number(b.team_member_id);
  const training = !!b.is_training;
  const note = b.note || null;

  // prior assignee (to notify if reassigned/removed)
  const prior = await sql`SELECT team_member_id FROM shifts WHERE shift_date = ${date}`;
  const priorMember: number | null = prior[0]?.team_member_id ?? null;

  await sql`
    INSERT INTO shifts (shift_date, start_time, end_time, team_member_id, is_training, note)
    VALUES (${date}, ${start}, ${end}, ${member}, ${training}, ${note})
    ON CONFLICT (shift_date) DO UPDATE SET
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
      team_member_id = EXCLUDED.team_member_id, is_training = EXCLUDED.is_training,
      note = EXCLUDED.note, reminder_sent = false, updated_at = now()
  `;

  // Ensure the week exists (as draft) so publish state is trackable.
  await sql`INSERT INTO schedule_weeks (week_start) VALUES (${weekStart})
            ON CONFLICT (week_start) DO NOTHING`;

  const wk = await sql`SELECT status FROM schedule_weeks WHERE week_start = ${weekStart}`;
  const published = wk[0]?.status === "published";

  // Notify affected staff only when the week is already live.
  if (published) {
    const affected = [...new Set([priorMember, member].filter((x): x is number => x != null))];
    for (const mid of affected) {
      const m = (await sql`SELECT name, email FROM team_members WHERE id = ${mid}`)[0];
      if (!m) continue;
      const summary =
        mid === member
          ? `You're now on ${fmtWeekday(date)} · ${prettyRange(start, end)}${training ? " · Training" : ""}.`
          : `Your ${fmtWeekday(date)} shift was changed.`;
      await createNotification({
        memberId: mid,
        kind: "schedule_changed",
        title: "Schedule changed",
        body: summary,
        link: "/my-shifts",
      });
      if (m.email) {
        try {
          await sendScheduleChanged({ to: m.email, name: m.name, weekLabel: weekLabel(weekStart), summary });
        } catch {
          /* non-fatal */
        }
      }
    }
  }

  await logAudit("shift_assign", { entity: "shift", entityId: date, detail: { member, training } }, admin);

  const shiftsRaw = await sql`
    SELECT id, to_char(shift_date,'YYYY-MM-DD') AS shift_date, start_time, end_time,
           team_member_id, is_training, note
    FROM shifts WHERE shift_date >= ${weekStart} AND shift_date <= ${weekDates(weekStart)[5]}
  `;
  const conflicts = await weekConflicts(weekStart, shiftsRaw as ShiftRow[]);
  return NextResponse.json({ ok: true, published, conflicts });
}
