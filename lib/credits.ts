import { sql } from "@/lib/db";
import {
  AmbassadorProgram,
  AmbassadorCredits,
  AmbassadorTier,
  DEFAULT_PROGRAM,
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
    blackout_dates: Array.isArray(v.blackout_dates) ? v.blackout_dates : [],
  };
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
