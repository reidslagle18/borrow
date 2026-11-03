import { sql } from "@/lib/db";

export interface Campaign {
  id: number;
  code: string;
  label: string | null;
  organization: string;
  donation_rate: number; // percent
  starts_on: string | null; // YYYY-MM-DD
  ends_on: string | null;
  active: boolean;
}

/** Normalize a user-entered code (trim + uppercase) for matching. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

export async function listCampaigns(): Promise<Campaign[]> {
  const rows = await sql`
    SELECT id, code, label, organization, donation_rate,
           to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
           to_char(ends_on, 'YYYY-MM-DD') AS ends_on, active
    FROM campaigns ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    code: String(r.code),
    label: r.label ?? null,
    organization: String(r.organization ?? ""),
    donation_rate: Number(r.donation_rate),
    starts_on: r.starts_on ?? null,
    ends_on: r.ends_on ?? null,
    active: r.active === true,
  }));
}

/**
 * The campaign for `code` IF it's valid to tag on `onDate` (default today,
 * America/Chicago): must exist, be active, and `onDate` within [starts_on, ends_on]
 * (open-ended if a bound is null). Returns null otherwise — so a code entered
 * outside its window simply doesn't tag the order.
 */
export async function activeCampaignForCode(
  code: unknown,
  onDate?: string
): Promise<Campaign | null> {
  const c = normalizeCode(code);
  if (!c) return null;
  const rows = await sql`
    SELECT id, code, label, organization, donation_rate,
           to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
           to_char(ends_on, 'YYYY-MM-DD') AS ends_on, active
    FROM campaigns
    WHERE upper(code) = ${c}
      AND active = true
      AND (starts_on IS NULL OR starts_on <= COALESCE(${onDate ?? null}::date, (now() AT TIME ZONE 'America/Chicago')::date))
      AND (ends_on   IS NULL OR ends_on   >= COALESCE(${onDate ?? null}::date, (now() AT TIME ZONE 'America/Chicago')::date))
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    code: String(r.code),
    label: r.label ?? null,
    organization: String(r.organization ?? ""),
    donation_rate: Number(r.donation_rate),
    starts_on: r.starts_on ?? null,
    ends_on: r.ends_on ?? null,
    active: r.active === true,
  };
}
