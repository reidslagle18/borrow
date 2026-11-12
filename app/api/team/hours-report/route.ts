import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import {
  getPayConfig,
  periodForDate,
  shiftPeriod,
  periodLabel,
  listDays,
  weeksInPeriod,
  workedMinutes,
  isPeriodClosed,
} from "@/lib/timeclock";

const WEEK_OT_MINUTES = 40 * 60;

/** GET /api/team/hours-report?period= — per-person hours by day + weekly >40 flags. */
export async function GET(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const url = new URL(request.url);
  const cfg = await getPayConfig();
  const period = periodForDate(url.searchParams.get("period") || todayISO(), cfg);
  const days = listDays(period);

  const rows = await sql`
    SELECT te.team_member_id AS mid, tm.name,
           (te.clock_in AT TIME ZONE 'America/Chicago')::date::text AS day,
           to_char(te.clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
           to_char(te.clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out
    FROM time_entries te JOIN team_members tm ON tm.id = te.team_member_id
    WHERE te.archived_at IS NULL AND te.clock_out IS NOT NULL
      AND (te.clock_in AT TIME ZONE 'America/Chicago')::date BETWEEN ${period.start} AND ${period.end}
  `;
  const activeMembers = await sql`SELECT id, name FROM team_members WHERE active = true ORDER BY name`;

  // minutes[mid][day]
  const names = new Map<number, string>();
  const minutes = new Map<number, Map<string, number>>();
  for (const m of activeMembers as { id: number; name: string }[]) {
    names.set(m.id, m.name);
    minutes.set(m.id, new Map());
  }
  for (const r of rows as { mid: number; name: string; day: string; clock_in: string; clock_out: string }[]) {
    names.set(r.mid, r.name);
    if (!minutes.has(r.mid)) minutes.set(r.mid, new Map());
    const mins = workedMinutes(r.clock_in, r.clock_out);
    const dm = minutes.get(r.mid)!;
    dm.set(r.day, (dm.get(r.day) ?? 0) + mins);
  }

  const weeks = weeksInPeriod(period);
  const members = [...names.keys()].map((mid) => {
    const dm = minutes.get(mid) || new Map();
    const perDay: Record<string, number> = {};
    let total = 0;
    for (const d of days) {
      const v = Math.round((dm.get(d) ?? 0) * 100) / 100;
      perDay[d] = v;
      total += v;
    }
    const weekFlags = weeks.map((w) => {
      let wm = 0;
      for (const d of listDays(w)) if (d >= period.start && d <= period.end) wm += dm.get(d) ?? 0;
      return { week_start: w.start, minutes: Math.round(wm), over40: wm > WEEK_OT_MINUTES };
    });
    return { id: mid, name: names.get(mid), per_day: perDay, total_minutes: Math.round(total), weeks: weekFlags };
  });
  members.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return NextResponse.json(
    {
      period: { start: period.start, end: period.end, label: periodLabel(period), closed: await isPeriodClosed(period.start) },
      prev: shiftPeriod(period.start, cfg, -1).start,
      next: shiftPeriod(period.start, cfg, 1).start,
      days,
      weeks: weeks.map((w) => ({ start: w.start, end: w.end })),
      members,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
