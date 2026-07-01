import type Stripe from "stripe";

/**
 * Live Terminal reader lookup. We never trust a stored/hardcoded reader id
 * (one saved in test mode doesn't exist in live mode → Stripe "No such
 * reader"). Instead we list the readers registered to the CURRENT API key's
 * account and resolve against that, so it's always correct for the active mode.
 */

export type LiveReader = {
  id: string;
  label: string | null;
  device_type: string;
  status: string;
  location: string | null;
  location_name: string | null;
};

/** All readers registered to this account (optionally filtered to a Location). */
export async function listLiveReaders(
  stripe: Stripe,
  locationId?: string
): Promise<LiveReader[]> {
  const params: Stripe.Terminal.ReaderListParams = { limit: 100 };
  if (locationId) params.location = locationId;
  const [readers, locations] = await Promise.all([
    stripe.terminal.readers.list(params),
    stripe.terminal.locations.list({ limit: 100 }),
  ]);
  const locName = new Map(locations.data.map((l) => [l.id, l.display_name]));
  return readers.data.map((r) => {
    const locId = typeof r.location === "string" ? r.location : r.location?.id ?? null;
    return {
      id: r.id,
      label: r.label,
      device_type: r.device_type,
      status: r.status ?? "unknown",
      location: locId,
      location_name: locId ? locName.get(locId) ?? null : null,
    };
  });
}

export type ReaderResolution =
  | { ok: true; reader_id: string }
  | { ok: false; reason: "none" }
  | { ok: false; reason: "multiple"; readers: LiveReader[] };

/**
 * Pick the reader to charge: honor a remembered preference IF it's really in the
 * live list; otherwise use the only reader if there's just one; otherwise ask
 * the caller to choose. Returns "none" when the account has no readers.
 */
export async function resolveReader(
  stripe: Stripe,
  preferredId?: string | null,
  locationId?: string
): Promise<ReaderResolution> {
  const readers = await listLiveReaders(stripe, locationId);
  if (readers.length === 0) return { ok: false, reason: "none" };
  if (preferredId && readers.some((r) => r.id === preferredId)) {
    return { ok: true, reader_id: preferredId };
  }
  if (readers.length === 1) return { ok: true, reader_id: readers[0].id };
  return { ok: false, reason: "multiple", readers };
}
