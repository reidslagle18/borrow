/** Local-timezone date helpers working on YYYY-MM-DD strings. */

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The studio's timezone. Everything "today"/"now" is computed here so the UTC
 *  server (and shoppers in other zones) agree with Fayetteville's local date —
 *  otherwise evenings roll a day ahead in UTC. */
export const STUDIO_TZ = "America/Chicago";

export function todayISO(): string {
  // en-CA formats as YYYY-MM-DD; timeZone pins it to the studio's local date.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function fmtShort(iso: string): string {
  return fromISO(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function fmtWeekday(iso: string): string {
  return fromISO(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Normalize a date value coming back from Postgres (may be ISO timestamp) to YYYY-MM-DD. */
export function dateOnly(value: string): string {
  return value.slice(0, 10);
}
