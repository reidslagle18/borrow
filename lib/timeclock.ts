/**
 * Server helpers for the time clock & timesheets. Re-exports the client-safe
 * helpers from lib/timeclock-shared.ts, plus DB-touching utilities: device
 * tokens, the append-only audit writer, pay-period config + closures, and the
 * labor-cost ESTIMATE.
 *
 * Invariants enforced here:
 *  - time records are never hard-deleted (archive via archived_at)
 *  - timestamps stored exact; no rounding / break deduction / discarding time
 *  - every mutation writes a time_entry_audit row with before/after + reason
 */
import { sql } from "@/lib/db";
import { getTeamSettings } from "@/lib/team";
import type { Session } from "@/lib/auth";
import {
  type PayPeriodConfig,
  type Period,
  periodForDate,
  shiftPeriod,
  periodLabel,
  weeksInPeriod,
  listDays,
  workedMinutes,
  toHours,
  fmtHoursMinutes,
  fmtClock,
  fmtDateTime,
  studioDay,
} from "@/lib/timeclock-shared";

export {
  periodForDate,
  shiftPeriod,
  periodLabel,
  weeksInPeriod,
  listDays,
  workedMinutes,
  toHours,
  fmtHoursMinutes,
  fmtClock,
  fmtDateTime,
  studioDay,
};
export type { PayPeriodConfig, Period };

export const CLOCK_DEVICE_COOKIE = "borrow_clock_device";

// ---- tokens / codes --------------------------------------------------------

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export function newDeviceToken(): string {
  return randomHex(24);
}
/** Human-typable one-time setup code, no ambiguous chars. */
export function newSetupCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}

// ---- pay-period config + closures -----------------------------------------

export async function getPayConfig(): Promise<PayPeriodConfig> {
  const s = await getTeamSettings();
  return { frequency: s.pay_period_frequency, anchor: s.pay_period_anchor };
}

export async function isPeriodClosed(periodStart: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM pay_period_closures
    WHERE period_start = ${periodStart} AND reopened_at IS NULL
  `;
  return rows.length > 0;
}

// ---- audit -----------------------------------------------------------------

type EntrySnapshot = Record<string, unknown> | null;

export async function writeTimeAudit(opts: {
  entryId: number;
  session: Session | null;
  action: string;
  reason?: string | null;
  before?: EntrySnapshot;
  after?: EntrySnapshot;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO time_entry_audit
        (time_entry_id, actor_id, actor_name, actor_role, action, reason, before, after)
      VALUES (
        ${opts.entryId},
        ${opts.session?.userId ?? null},
        ${opts.session?.name ?? "Owner"},
        ${opts.session?.trueRole ?? "admin"},
        ${opts.action},
        ${opts.reason ?? null},
        ${opts.before ? JSON.stringify(opts.before) : null}::jsonb,
        ${opts.after ? JSON.stringify(opts.after) : null}::jsonb
      )
    `;
  } catch (err) {
    console.error("[timeclock] writeTimeAudit failed:", (err as Error).message);
  }
}

// ---- entry helpers ---------------------------------------------------------

export async function openEntryForMember(memberId: number) {
  const rows = await sql`
    SELECT id, clock_in, shift_id, missed_clockout
    FROM time_entries
    WHERE team_member_id = ${memberId} AND clock_out IS NULL AND archived_at IS NULL
    ORDER BY clock_in DESC LIMIT 1
  `;
  return rows[0] || null;
}

/** Active registered device for a cookie token, or null. */
export async function deviceFromToken(token: string | undefined | null) {
  if (!token) return null;
  const rows = await sql`
    SELECT id, name, active FROM clock_devices
    WHERE token = ${token} AND active = true AND registered_at IS NOT NULL
    LIMIT 1
  `;
  return rows[0] || null;
}

// ---- labor cost ESTIMATE (admin only; never payroll, never taxes) ----------

/**
 * Sum approved/completed (non-archived) worked minutes × each member's hourly
 * rate for a date range. Members without a rate contribute 0. This is an
 * estimate only — no taxes, no withholding.
 */
export async function laborEstimate(fromISODate: string, toISODate: string): Promise<number> {
  const rows = await sql`
    SELECT te.clock_in, te.clock_out, tm.hourly_rate
    FROM time_entries te JOIN team_members tm ON tm.id = te.team_member_id
    WHERE te.archived_at IS NULL
      AND te.clock_out IS NOT NULL
      AND tm.hourly_rate IS NOT NULL
      AND te.clock_in >= ${fromISODate} AND te.clock_in < ${toISODate}
  `;
  let total = 0;
  for (const r of rows as { clock_in: string; clock_out: string; hourly_rate: string }[]) {
    const mins = workedMinutes(r.clock_in, r.clock_out);
    total += (mins / 60) * Number(r.hourly_rate);
  }
  return Math.round(total * 100) / 100;
}
