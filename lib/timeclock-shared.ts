/**
 * Pure, client-safe helpers for the time clock & timesheets: pay-period math,
 * duration, and America/Chicago time formatting. NO server/database imports.
 * Server code imports the same names via lib/timeclock.ts (re-exports these).
 */
import { fromISO, toISO, addDays } from "@/lib/dates";

export const STUDIO_TZ = "America/Chicago";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly";
export interface PayPeriodConfig {
  frequency: PayFrequency;
  anchor: string; // YYYY-MM-DD — the first day of a reference period (weekly/biweekly)
}
export const DEFAULT_PAY_PERIOD: PayPeriodConfig = {
  frequency: "biweekly",
  anchor: "2026-01-05", // a Monday; owner can change in settings
};

export interface Period {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
}

function lastOfMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

/** The pay period that contains `dateISO`, per the configured frequency. */
export function periodForDate(dateISO: string, cfg: PayPeriodConfig): Period {
  const date = dateISO.slice(0, 10);
  if (cfg.frequency === "semimonthly") {
    const [y, m] = date.split("-").map(Number);
    const day = Number(date.slice(8, 10));
    if (day <= 15) return { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-15` };
    const last = lastOfMonth(y, m - 1);
    return { start: `${date.slice(0, 7)}-16`, end: `${date.slice(0, 7)}-${String(last).padStart(2, "0")}` };
  }
  const span = cfg.frequency === "weekly" ? 7 : 14;
  // whole-number of spans between anchor and date (floor toward -inf)
  const a = fromISO(cfg.anchor);
  const d = fromISO(date);
  const diffDays = Math.floor((d.getTime() - a.getTime()) / 86_400_000);
  const k = Math.floor(diffDays / span);
  const start = addDays(cfg.anchor, k * span);
  return { start, end: addDays(start, span - 1) };
}

/** Move to the previous/next period relative to one starting at periodStart. */
export function shiftPeriod(periodStart: string, cfg: PayPeriodConfig, delta: number): Period {
  if (cfg.frequency === "semimonthly") {
    // step by half-months
    let cur = periodForDate(periodStart, cfg);
    const step = delta >= 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(delta); i++) {
      const nextAnchor = step > 0 ? addDays(cur.end, 1) : addDays(cur.start, -1);
      cur = periodForDate(nextAnchor, cfg);
    }
    return cur;
  }
  const span = cfg.frequency === "weekly" ? 7 : 14;
  const start = addDays(periodStart, delta * span);
  return { start, end: addDays(start, span - 1) };
}

export function periodLabel(p: Period): string {
  const f = (iso: string) => fromISO(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const y = fromISO(p.end).getFullYear();
  return `${f(p.start)} – ${f(p.end)}, ${y}`;
}

/** The weeks (Mon–Sun) overlapping a period — used for the >40h weekly flag. */
export function weeksInPeriod(p: Period): Period[] {
  const out: Period[] = [];
  // walk day by day, grouping by ISO week starting Monday
  let cursor = p.start;
  const seen = new Set<string>();
  while (cursor <= p.end) {
    const d = fromISO(cursor);
    const dow = d.getDay();
    const weekStart = addDays(cursor, dow === 0 ? -6 : 1 - dow);
    if (!seen.has(weekStart)) {
      seen.add(weekStart);
      out.push({ start: weekStart, end: addDays(weekStart, 6) });
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function listDays(p: Period): string[] {
  const out: string[] = [];
  let c = p.start;
  while (c <= p.end) {
    out.push(c);
    c = addDays(c, 1);
  }
  return out;
}

// ---- duration & formatting -------------------------------------------------

/** Exact worked minutes between two ISO timestamps (no rounding of the stored
 *  times). Returns 0 if either side is missing. */
export function workedMinutes(clockIn: string | null, clockOut: string | null): number {
  if (!clockIn || !clockOut) return 0;
  const ms = Date.parse(clockOut) - Date.parse(clockIn);
  return ms > 0 ? ms / 60000 : 0;
}

/** Decimal hours to 2dp for display/CSV (presentation only — not stored). */
export function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function fmtHoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Format an ISO timestamp as a studio-local clock time, e.g. "12:03 PM". */
export function fmtClock(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: STUDIO_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format an ISO timestamp as studio-local date + time. */
export function fmtDateTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    timeZone: STUDIO_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Studio-local YYYY-MM-DD for an ISO timestamp (which day a punch belongs to). */
export function studioDay(ts: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

export { toISO };
