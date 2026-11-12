/**
 * Shared helpers for the Team / front-desk scheduling feature:
 * week math (weeks run Mon–Sat), time formatting, team settings, conflict
 * detection, iCal feed generation, and in-app notification creation.
 *
 * Privacy: this feature stores only scheduling + contact data. Never put SSNs,
 * bank details, ID documents, or tax forms through here.
 */
import { sql } from "@/lib/db";
import { fromISO, toISO, addDays, fmtShort } from "@/lib/dates";
import {
  DEFAULT_START,
  DEFAULT_END,
  WEEKDAY_NAMES,
  ONBOARDING_STEPS,
  openOnboardingCount,
  prettyTime,
  prettyRange,
  type ConflictKind,
} from "@/lib/team-shared";

// Re-export the client-safe helpers so existing server imports from "@/lib/team"
// keep working. Client components should import these from "@/lib/team-shared".
export {
  DEFAULT_START,
  DEFAULT_END,
  WEEKDAY_NAMES,
  ONBOARDING_STEPS,
  openOnboardingCount,
  prettyTime,
  prettyRange,
};
export type { ConflictKind };

/** The Monday (YYYY-MM-DD) of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const d = fromISO(iso);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const delta = dow === 0 ? -6 : 1 - dow; // back up to Monday
  return addDays(iso, delta);
}

/** The six working dates Mon–Sat for a week starting on `weekStart` (a Monday). */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));
}

/** "Nov 10 – 15" style label for a week. */
export function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, 5);
  return `${fmtShort(weekStart)} – ${fmtShort(end)}`;
}

// ---- Team settings (app_settings key 'team_settings') ----------------------

export interface TeamSettings {
  sms_enabled: boolean; // master on/off for SMS
  sms_from_approved: boolean; // owner's sending number approved yet?
  owner_sms: string; // owner's mobile for SMS (not sensitive)
  default_start: string;
  default_end: string;
}

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  sms_enabled: false, // OFF until the owner's text number is approved
  sms_from_approved: false,
  owner_sms: "",
  default_start: DEFAULT_START,
  default_end: DEFAULT_END,
};

export async function getTeamSettings(): Promise<TeamSettings> {
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'team_settings'`;
  if (rows.length === 0) return DEFAULT_TEAM_SETTINGS;
  const v = (rows[0].value || {}) as Partial<TeamSettings>;
  return { ...DEFAULT_TEAM_SETTINGS, ...v };
}

export async function saveTeamSettings(s: TeamSettings): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('team_settings', ${JSON.stringify(s)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

// ---- Tokens ----------------------------------------------------------------

/** A URL-safe random token for a member's personal iCal feed. */
export function newIcalToken(): string {
  // 24 hex chars — plenty of entropy, no external deps.
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Notifications ---------------------------------------------------------

export async function createNotification(opts: {
  memberId?: number | null;
  toAdmin?: boolean;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO team_notifications (team_member_id, to_admin, kind, title, body, link)
      VALUES (${opts.memberId ?? null}, ${opts.toAdmin ?? false}, ${opts.kind},
              ${opts.title}, ${opts.body ?? null}, ${opts.link ?? null})
    `;
  } catch (err) {
    console.error("[team] createNotification failed:", (err as Error).message);
  }
}

// ---- Conflict detection ----------------------------------------------------

export interface ShiftRow {
  id: number;
  shift_date: string;
  start_time: string;
  end_time: string;
  team_member_id: number | null;
  is_training: boolean;
  note: string | null;
}

/**
 * Compute conflicts for every assigned shift in a week. Returns a map of
 * shift_id → conflict kinds. Pulls time-off, availability, unavailable dates,
 * and per-member max limits in one pass.
 */
export async function weekConflicts(
  weekStart: string,
  shifts: ShiftRow[]
): Promise<Record<number, ConflictKind[]>> {
  const dates = weekDates(weekStart);
  const assigned = shifts.filter((s) => s.team_member_id != null);
  const memberIds = [...new Set(assigned.map((s) => s.team_member_id as number))];
  const out: Record<number, ConflictKind[]> = {};
  if (memberIds.length === 0) return out;

  const weekEnd = addDays(weekStart, 5);
  const [timeOff, avail, oneOff, members] = await Promise.all([
    sql`SELECT team_member_id, start_date, end_date FROM time_off
         WHERE status = 'approved' AND team_member_id = ANY(${memberIds})
           AND start_date <= ${weekEnd} AND end_date >= ${weekStart}`,
    sql`SELECT team_member_id, weekday, available FROM availability
         WHERE team_member_id = ANY(${memberIds})`,
    sql`SELECT team_member_id, to_char(the_date, 'YYYY-MM-DD') AS d FROM unavailable_dates
         WHERE team_member_id = ANY(${memberIds})
           AND the_date >= ${weekStart} AND the_date <= ${weekEnd}`,
    sql`SELECT id, max_shifts_per_week FROM team_members WHERE id = ANY(${memberIds})`,
  ]);

  const offRanges = (timeOff as { team_member_id: number; start_date: string; end_date: string }[]).map(
    (t) => ({ m: t.team_member_id, s: t.start_date.slice(0, 10), e: t.end_date.slice(0, 10) })
  );
  const unavailWeekday = new Set(
    (avail as { team_member_id: number; weekday: number; available: boolean }[])
      .filter((a) => !a.available)
      .map((a) => `${a.team_member_id}:${a.weekday}`)
  );
  const unavailDate = new Set(
    (oneOff as { team_member_id: number; d: string }[]).map((o) => `${o.team_member_id}:${o.d}`)
  );
  const maxByMember = new Map(
    (members as { id: number; max_shifts_per_week: number | null }[]).map((m) => [
      m.id,
      m.max_shifts_per_week,
    ])
  );

  // shifts-per-member this week (for over-max)
  const countByMember = new Map<number, number>();
  for (const s of assigned) {
    const m = s.team_member_id as number;
    countByMember.set(m, (countByMember.get(m) ?? 0) + 1);
  }
  // same-day double booking (defensive — unique(shift_date) normally prevents it)
  const perDayMember = new Map<string, number>();
  for (const s of assigned) {
    const key = `${s.shift_date.slice(0, 10)}`;
    perDayMember.set(key, (perDayMember.get(key) ?? 0) + 1);
  }

  for (const s of assigned) {
    const m = s.team_member_id as number;
    const date = s.shift_date.slice(0, 10);
    const weekday = fromISO(date).getDay();
    const flags: ConflictKind[] = [];
    if (offRanges.some((r) => r.m === m && date >= r.s && date <= r.e)) flags.push("timeoff");
    if (unavailWeekday.has(`${m}:${weekday}`)) flags.push("unavailable_recurring");
    if (unavailDate.has(`${m}:${date}`)) flags.push("unavailable_date");
    const max = maxByMember.get(m);
    if (max != null && (countByMember.get(m) ?? 0) > max) flags.push("over_max");
    if ((perDayMember.get(date) ?? 0) > 1) flags.push("double_booked");
    if (flags.length) out[s.id] = flags;
    void dates; // retained for potential future per-date logic
  }
  return out;
}

// ---- iCal feed -------------------------------------------------------------

function icalEscape(s: string): string {
  return (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function icalStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function localDT(dateISO: string, hhmm: string): string {
  const [h, m] = (hhmm || "00:00").split(":");
  return `${dateISO.replace(/-/g, "")}T${(h ?? "00").padStart(2, "0")}${(m ?? "00").padStart(2, "0")}00`;
}

/**
 * Build an iCal document for a member's shifts. Emits floating local times
 * (no TZ suffix) — staff phones are in the studio's timezone, so the wall-clock
 * time is correct, and this avoids shipping a full VTIMEZONE block.
 */
export function buildICal(
  memberName: string,
  shifts: { id: number; shift_date: string; start_time: string; end_time: string; is_training: boolean }[],
  now: Date
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BORROW//Team Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icalEscape(`BORROW shifts — ${memberName}`)}`,
    "X-WR-TIMEZONE:America/Chicago",
  ];
  for (const s of shifts) {
    const date = s.shift_date.slice(0, 10);
    lines.push(
      "BEGIN:VEVENT",
      `UID:shift-${s.id}@borrow`,
      `DTSTAMP:${icalStamp(now)}`,
      `DTSTART:${localDT(date, s.start_time)}`,
      `DTEND:${localDT(date, s.end_time)}`,
      `SUMMARY:${icalEscape(s.is_training ? "BORROW shift (Training)" : "BORROW shift")}`,
      "LOCATION:BORROW",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  // iCal lines are CRLF-terminated.
  return lines.join("\r\n") + "\r\n";
}

// ---- Member lookup for the logged-in staffer -------------------------------

/** Resolve the team_member row linked to a staff login (session.userId). */
export async function memberForStaffUser(
  staffUserId: number
): Promise<{ id: number; name: string; email: string | null } | null> {
  const rows = await sql`
    SELECT id, name, email FROM team_members
    WHERE staff_user_id = ${staffUserId} AND active = true
    LIMIT 1
  `;
  return (rows[0] as { id: number; name: string; email: string | null }) || null;
}

export { toISO };
