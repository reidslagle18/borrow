import { sql } from "@/lib/db";

/**
 * Consignor commission rate (%) in effect on a given date, from the
 * consignor_rate_schedule. Returns the rate whose effective_from is the latest
 * on/before `dateISO`. Falls back to 60 (the earliest historical rate) if the
 * schedule somehow has no matching row, so we never under-promise.
 */
export async function rateInEffectOn(dateISO: string): Promise<number> {
  const rows = await sql`
    SELECT rate FROM consignor_rate_schedule
    WHERE effective_from <= ${dateISO}::date
    ORDER BY effective_from DESC
    LIMIT 1
  `;
  return rows[0]?.rate != null ? Number(rows[0].rate) : 60;
}

/** The consignor rate (%) in effect today — the current default for a brand-new
 *  consignor with no earlier drop-off appointment on record. */
export async function currentConsignorRate(): Promise<number> {
  const rows = await sql`
    SELECT rate FROM consignor_rate_schedule
    WHERE effective_from <= (now() AT TIME ZONE 'America/Chicago')::date
    ORDER BY effective_from DESC
    LIMIT 1
  `;
  return rows[0]?.rate != null ? Number(rows[0].rate) : 60;
}
