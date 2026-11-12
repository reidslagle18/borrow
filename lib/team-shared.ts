/**
 * Pure, client-safe helpers for the Team / scheduling feature — NO database or
 * server-only imports, so client components can import these without pulling the
 * Neon driver into the browser bundle. Server code imports the same names via
 * lib/team.ts (which re-exports these).
 */

export const DEFAULT_START = "11:55";
export const DEFAULT_END = "16:55";
// The store is open 12–4; staff arrive ~5 min early and leave ~5 min after.

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The manual onboarding checklist the owner ticks for each new hire. */
export const ONBOARDING_STEPS = [
  { key: "invite_sent", label: "Invite sent" },
  { key: "paid_training_done", label: "Paid training done" },
  { key: "login_created", label: "Staff login created" },
] as const;

/** Count of checklist steps not yet ticked (what "open items" means in the list). */
export function openOnboardingCount(onboarding: Record<string, unknown> | null | undefined): number {
  const o = onboarding || {};
  return ONBOARDING_STEPS.filter((s) => !o[s.key]).length;
}

/** "11:55" → "11:55 AM". */
export function prettyTime(hhmm: string): string {
  const [hStr, m] = (hhmm || "").split(":");
  const h = Number(hStr);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${(m ?? "00").padStart(2, "0")} ${ampm}`;
}

/** "11:55" + "16:55" → "11:55 AM – 4:55 PM". */
export function prettyRange(start: string, end: string): string {
  return `${prettyTime(start)} – ${prettyTime(end)}`;
}

export type ConflictKind =
  | "timeoff"
  | "unavailable_recurring"
  | "unavailable_date"
  | "over_max"
  | "double_booked";
