import { ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { getPayConfig, periodForDate, periodLabel, listDays, workedMinutes, toHours } from "@/lib/timeclock";

/**
 * CSV export of the pay-period hours report for payroll. One row per person per
 * day with hours, plus a total column. Hours shown to 2 decimals (exact
 * timestamps underneath — no rounding of the stored punches).
 * GET /api/team/hours-report/export?period=
 */
export async function GET(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return new Response("Admins only", { status: 403 });

  const url = new URL(request.url);
  const cfg = await getPayConfig();
  const period = periodForDate(url.searchParams.get("period") || todayISO(), cfg);
  const days = listDays(period);

  const rows = await sql`
    SELECT tm.name,
           (te.clock_in AT TIME ZONE 'America/Chicago')::date::text AS day,
           to_char(te.clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
           to_char(te.clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out
    FROM time_entries te JOIN team_members tm ON tm.id = te.team_member_id
    WHERE te.archived_at IS NULL AND te.clock_out IS NOT NULL
      AND (te.clock_in AT TIME ZONE 'America/Chicago')::date BETWEEN ${period.start} AND ${period.end}
  `;
  const byName = new Map<string, Map<string, number>>();
  for (const r of rows as { name: string; day: string; clock_in: string; clock_out: string }[]) {
    if (!byName.has(r.name)) byName.set(r.name, new Map());
    const dm = byName.get(r.name)!;
    dm.set(r.day, (dm.get(r.day) ?? 0) + workedMinutes(r.clock_in, r.clock_out));
  }

  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const header = ["Employee", ...days, "Total (hrs)"];
  const lines = [header.map(esc).join(",")];
  for (const name of [...byName.keys()].sort()) {
    const dm = byName.get(name)!;
    let total = 0;
    const cells = days.map((d) => {
      const h = toHours(dm.get(d) ?? 0);
      total += h;
      return h ? h.toFixed(2) : "";
    });
    lines.push([esc(name), ...cells, (Math.round(total * 100) / 100).toFixed(2)].join(","));
  }
  const csv = `BORROW hours — ${periodLabel(period)}\n` + lines.join("\n") + "\n";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="borrow-hours-${period.start}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
