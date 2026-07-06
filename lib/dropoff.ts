import { sql } from "@/lib/db";

/** Configurable drop-off booking window (stored in app_settings 'dropoff'). */
export interface DropoffConfig {
  open_days: number[]; // 0=Sun … 6=Sat
  open_time: string; // "HH:MM"
  close_time: string; // "HH:MM"
  slot_minutes: number; // slot length
  closed_dates: string[]; // YYYY-MM-DD blackout/closed days
}

export const DEFAULT_DROPOFF: DropoffConfig = {
  open_days: [1, 2, 3, 4, 5, 6], // Mon–Sat
  open_time: "10:00",
  close_time: "18:00",
  slot_minutes: 15,
  closed_dates: [],
};

export async function getDropoffConfig(): Promise<DropoffConfig> {
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'dropoff'`;
  const v = (rows[0]?.value ?? {}) as Partial<DropoffConfig>;
  return {
    open_days: Array.isArray(v.open_days) ? v.open_days : DEFAULT_DROPOFF.open_days,
    open_time: v.open_time || DEFAULT_DROPOFF.open_time,
    close_time: v.close_time || DEFAULT_DROPOFF.close_time,
    slot_minutes: v.slot_minutes || DEFAULT_DROPOFF.slot_minutes,
    closed_dates: Array.isArray(v.closed_dates) ? v.closed_dates : [],
  };
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Weekday (0=Sun) of a plain YYYY-MM-DD, tz-safe (read at noon UTC). */
function weekday(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** The studio's current local date/time (America/Chicago), for past-slot filtering. */
export function centralNow(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${g("year")}-${g("month")}-${g("day")}`,
    minutes: Number(g("hour")) * 60 + Number(g("minute")),
  };
}

/** All slot start times ("HH:MM") the config allows on a date (ignores bookings). */
export function slotsForDate(cfg: DropoffConfig, dateStr: string): string[] {
  if (!cfg.open_days.includes(weekday(dateStr))) return [];
  if (cfg.closed_dates.includes(dateStr)) return [];
  const start = toMin(cfg.open_time);
  const end = toMin(cfg.close_time);
  const out: string[] = [];
  for (let t = start; t < end; t += cfg.slot_minutes) out.push(toHHMM(t));
  return out;
}

/**
 * Available slots for a date: config slots minus already-booked ones, minus any
 * that are in the past (studio local time), with a small lead-time buffer today.
 */
export async function availableSlots(dateStr: string): Promise<string[]> {
  const cfg = await getDropoffConfig();
  let slots = slotsForDate(cfg, dateStr);
  if (slots.length === 0) return [];

  const now = centralNow();
  if (dateStr < now.date) return []; // whole day is past
  if (dateStr === now.date) {
    const cutoff = now.minutes + 30; // 30-min lead time
    slots = slots.filter((s) => toMin(s) >= cutoff);
  }

  const booked = await sql`
    SELECT slot_time FROM drop_off_appointments
    WHERE slot_date = ${dateStr} AND status = 'booked'
  `;
  const taken = new Set(booked.map((b) => String(b.slot_time)));
  return slots.filter((s) => !taken.has(s));
}
