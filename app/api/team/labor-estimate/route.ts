import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { todayISO, addDays, fromISO, toISO } from "@/lib/dates";
import { laborEstimate } from "@/lib/timeclock";

/**
 * Admin-only ESTIMATED labor cost for the current week and month, from each
 * person's hourly rate × worked hours. Estimate only — no taxes, not payroll.
 * Never exposed to staff (requireAdmin + hourly_rate never leaves the server).
 */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const today = todayISO();
  const d = fromISO(today);
  const dow = d.getDay();
  const weekStart = addDays(today, dow === 0 ? -6 : 1 - dow); // Monday
  const weekEnd = addDays(weekStart, 7); // exclusive
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const monthEnd = toISO(new Date(y, m, 1)); // first of next month (exclusive)

  const [week, month] = await Promise.all([
    laborEstimate(weekStart, weekEnd),
    laborEstimate(monthStart, monthEnd),
  ]);

  return NextResponse.json(
    { week, month, week_start: weekStart, month_start: monthStart, note: "Estimate, not payroll. No taxes calculated or withheld." },
    { headers: { "Cache-Control": "no-store" } }
  );
}
