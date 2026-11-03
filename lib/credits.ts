import { sql } from "@/lib/db";
import {
  AmbassadorProgram,
  AmbassadorCredits,
  AmbassadorTier,
  DEFAULT_PROGRAM,
  cleanOccasions,
} from "@/lib/types";

/** Current YYYY-MM in the studio's local terms (server is UTC; close enough). */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Load the ambassador-program config, merged over defaults. */
export async function getProgram(): Promise<AmbassadorProgram> {
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'ambassador_program'`;
  if (rows.length === 0) return DEFAULT_PROGRAM;
  const v = rows[0].value as Partial<AmbassadorProgram>;
  return {
    credits: {
      curator: { ...DEFAULT_PROGRAM.credits.curator, ...v.credits?.curator },
      poster: { ...DEFAULT_PROGRAM.credits.poster, ...v.credits?.poster },
    },
    cleaning_rate: v.cleaning_rate ?? DEFAULT_PROGRAM.cleaning_rate,
    cleaning_fee: v.cleaning_fee ?? DEFAULT_PROGRAM.cleaning_fee,
    retrieval_cleaning_fee:
      v.retrieval_cleaning_fee ?? DEFAULT_PROGRAM.retrieval_cleaning_fee,
    blackout_dates: Array.isArray(v.blackout_dates) ? v.blackout_dates : [],
    store_closed_dates: Array.isArray(v.store_closed_dates) ? v.store_closed_dates : [],
    store_closed_weekdays: Array.isArray(v.store_closed_weekdays)
      ? v.store_closed_weekdays.map(Number).filter((n) => n >= 0 && n <= 6)
      : [],
    color_swatches:
      v.color_swatches && typeof v.color_swatches === "object" && !Array.isArray(v.color_swatches)
        ? (v.color_swatches as Record<string, string>)
        : DEFAULT_PROGRAM.color_swatches,
    posting_target: v.posting_target ?? DEFAULT_PROGRAM.posting_target,
    post_credit: v.post_credit ?? DEFAULT_PROGRAM.post_credit,
    terminal_reader_id: v.terminal_reader_id ?? DEFAULT_PROGRAM.terminal_reader_id,
    hanger_fee: v.hanger_fee ?? DEFAULT_PROGRAM.hanger_fee,
    garment_bag_fee: v.garment_bag_fee ?? DEFAULT_PROGRAM.garment_bag_fee,
    turnaround_days: v.turnaround_days ?? DEFAULT_PROGRAM.turnaround_days,
    reservation_protect_days: v.reservation_protect_days ?? DEFAULT_PROGRAM.reservation_protect_days,
    hold_notice_lead_days: v.hold_notice_lead_days ?? DEFAULT_PROGRAM.hold_notice_lead_days,
    sales_tax_rate: v.sales_tax_rate ?? DEFAULT_PROGRAM.sales_tax_rate,
    reservations_open: v.reservations_open ?? DEFAULT_PROGRAM.reservations_open,
    underperformance_days: v.underperformance_days ?? DEFAULT_PROGRAM.underperformance_days,
    storage_window_days: v.storage_window_days ?? DEFAULT_PROGRAM.storage_window_days,
    approval_batch_window_min:
      v.approval_batch_window_min ?? DEFAULT_PROGRAM.approval_batch_window_min,
    // Fall back to the seed occasions only when NOTHING is stored yet, so an
    // owner who deletes them all doesn't get the defaults resurrected.
    occasions:
      v.occasions === undefined
        ? DEFAULT_PROGRAM.occasions
        : cleanOccasions(v.occasions),
  };
}

/**
 * Pace-based posting status. Behind if this month's posts are under the count
 * we'd expect by this point in the month — lenient early, strict near the end.
 * On Track once they're pacing toward the target or have already met it.
 */
export function postingStatus(
  count: number,
  target: number,
  now: Date = new Date()
): { onTrack: boolean; expected: number } {
  const day = now.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const expected = Math.floor((target * day) / daysInMonth);
  const onTrack = count >= target || count >= expected;
  return { onTrack, expected };
}

type CreditRow = {
  id: number;
  tier: AmbassadorTier;
  credit_period: string | null;
  free_used: number;
  rate_used: number;
  bonus_earned: number;
  bonus_used: number;
};

/**
 * Resets an ambassador's counters if we've rolled into a new month, persisting
 * the reset. Returns the (possibly reset) counters for the current period.
 */
export async function ensureCurrentPeriod(a: CreditRow): Promise<CreditRow> {
  const period = currentPeriod();
  if (a.credit_period === period) return a;
  await sql`
    UPDATE ambassadors SET
      credit_period = ${period},
      free_used = 0, rate_used = 0, bonus_earned = 0, bonus_used = 0
    WHERE id = ${a.id}
  `;
  return {
    ...a,
    credit_period: period,
    free_used: 0,
    rate_used: 0,
    bonus_earned: 0,
    bonus_used: 0,
  };
}

/** Remaining credits this period, given the program allowances for the tier. */
export function remainingCredits(
  a: CreditRow,
  program: AmbassadorProgram
): AmbassadorCredits {
  const allow = program.credits[a.tier];
  return {
    free: Math.max(0, allow.free - a.free_used),
    rate: Math.max(0, allow.rate - a.rate_used),
    bonus: Math.max(0, a.bonus_earned - a.bonus_used),
  };
}

export function isBlackout(date: string, program: AmbassadorProgram): boolean {
  return program.blackout_dates.includes(date);
}
