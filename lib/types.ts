export type Tier = "value" | "standard" | "mid" | "high" | "premium";
export type Ownership = "owned" | "consignment" | "ambassador";
export type ItemStatus =
  | "available"
  | "reserved"
  | "rented"
  | "consignor_hold"
  | "cleaning"
  | "retired"
  | "with_consignor"
  | "in_storage";

export interface Consignor {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  venmo: string | null;
  payout_backup: string | null;
  // Signed digital agreement record (null until they sign).
  agreement_signed_name?: string | null;
  agreement_signed_at?: string | null;
  agreement_signed_ip?: string | null;
  agreement_version?: string | null;
  // Locked commission rate (%), set once at signing and never auto-changed.
  consignor_rate?: number | null;
  agreement_signed_rate?: number | null; // rate snapshot at signing
  agreement_signed_terms?: string | null; // exact agreement text snapshot at signing
  approval_email_sent_at?: string | null; // last "your items are ready to approve" email
}

export interface Item {
  id: string;
  barcode: string;
  name: string | null; // custom display name; used as the heading everywhere
  brand: string;
  description: string | null;
  size: string;
  color: string | null;
  fabric: string | null;
  fit_notes: string | null;
  silhouette: string | null;
  style_tags?: string[]; // freeform descriptive tags (e.g. "sparkly","backless") — powers smart search
  occasion_tags?: string[]; // top-level occasions (e.g. "Vacation","Date Night") — config-driven, owner-editable in Settings
  sub_occasion_tags?: string[]; // namespaced "Occasion:Sub" (e.g. "Vacation:Beach") so a sub always ties to its parent occasion
  new_with_tags: boolean; // brand new, original retail tags still attached
  ambassador_id: number | null; // ambassador who sourced/brought in the piece
  ambassador_name?: string | null;
  initial_cleaned?: boolean; // derived (item detail): an 'initial' dry-clean charge exists
  tier: Tier;
  rental_price: number;
  purchase_cost: number | null; // acquisition cost
  retail_value: number | null; // retail value
  // Agreed loss/replacement value charged if the piece is lost or damaged
  // beyond repair. Defaults to max(70% of retail, acquisition cost); once
  // hand-edited, replacement_value_manual stays true and the default is frozen.
  replacement_value: number | null;
  replacement_value_manual: boolean;
  replacement_confirmed_at?: string | null; // when the agreed value was confirmed at intake
  set_group?: string | null; // matching-set id; pieces sharing it are one outfit
  approval_status?: string | null; // consignment: 'pending' | 'approved' | 'disputed'
  approval_notified_at?: string | null; // when the consignor was emailed this piece is ready to approve
  retrieval_hold_date?: string | null; // DEPRECATED — superseded by hold_start/hold_end (kept for back-compat)
  hold_start?: string | null; // consignor self-hold: first day the piece is theirs (blocks bookings from here)
  hold_end?: string | null; // consignor self-hold: requested return date (informational — piece stays on hold until manually returned)
  next_reservation_date?: string | null; // earliest upcoming reservation pickup (for the Last Safe Rental Date guard)
  approved_at?: string | null;
  disputed_at?: string | null;
  disputed_value?: number | string | null; // consignor's suggested replacement value
  dispute_note?: string | null;
  dispute_outcome?: string | null; // after admin resolves: 'accepted' | 'rejected'
  acquisition_date: string | null; // YYYY-MM-DD
  source: string | null;
  condition_notes: string | null; // condition / damage notes
  ownership: Ownership;
  consignor_id: number | null;
  consignor_name?: string | null;
  event_types: string[];
  status: ItemStatus;
  location: string | null;
  photo_url: string | null; // cover photo (first of photos)
  photos: string[];
  rental_count: number;
  cleaning_count: number;
  created_at: string; // date added
  retired_at: string | null; // date retired
  pickup_requested_at?: string | null; // studio asked the consignor to collect it
  // Underperforming-item pickup + storage lifecycle.
  underperf_dismissed_at?: string | null; // "give it more time" — resets the underperformance clock
  pickup_notice_sent_at?: string | null; // 30-day pickup notice emailed (owner-approved)
  pickup_reminder_sent_at?: string | null; // 5-days-before reminder emailed
  storage_started_at?: string | null; // moved to storage; starts the storage-window clock
  storage_decided_at?: string | null; // owner acknowledged the unclaimed-in-storage flag
}

/**
 * Legacy flat share — kept only as a safe fallback. Real splits use each
 * consignor's own locked `consignor_rate` (see `consignorShare`).
 */
export const CONSIGNOR_SHARE = 0.6;

/**
 * Fallback default rate (%) for a genuinely new consignor. The live default is
 * driven by the consignor_rate_schedule (see lib/rates.ts) — currently 20% as
 * of 2026-08-04; this constant is only a safety fallback if the schedule is
 * unavailable.
 */
export const DEFAULT_CONSIGNOR_RATE = 20;

/**
 * The grandfathered rate (%) honored for anyone who was in the pipeline before
 * the switch to 50%. Used whenever a consignor's rate isn't yet locked AND we
 * can't positively match them to a post-switch (50%) drop-off appointment — we
 * default to 60% so no one who was promised 60% is ever shortchanged.
 */
export const GRANDFATHERED_CONSIGNOR_RATE = 60;

/**
 * A consignor's share of a rental as a fraction, from their locked % rate.
 * Null (never locked) falls back to 60% so nobody is ever underpaid by default;
 * every signed consignor has an explicit rate. Borrow keeps 1 - this.
 */
export function consignorShare(ratePct: number | null | undefined): number {
  const r = ratePct == null ? 60 : Number(ratePct);
  return (Number.isFinite(r) ? r : 60) / 100;
}

/**
 * Default agreed replacement value for a piece: the GREATER of 70% of its
 * retail value or its acquisition cost (whole dollars). For consigned pieces
 * with no acquisition cost this resolves to 70% of retail.
 */
export function replacementDefault(
  retail: number | null | undefined,
  cost: number | null | undefined
): number {
  const r = Number(retail) || 0;
  const c = Number(cost) || 0;
  return Math.max(Math.ceil(r * 0.7), Math.ceil(c));
}

/** Standard rental window, in days. */
export const RENTAL_DAYS = 7;

/** Per-item-per-day rate for late returns AND for booked days beyond the
 *  standard week (an extended rental costs this much for each extra day). */
export const EXTRA_DAY_RATE = 15;

/** Whole days between two YYYY-MM-DD dates (due − start), never negative. */
export function daysBetween(startISO: string, dueISO: string): number {
  const a = new Date(startISO.slice(0, 10) + "T12:00:00Z").getTime();
  const b = new Date(dueISO.slice(0, 10) + "T12:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Extra rental days booked beyond the standard week (0 for a normal rental). */
export function extraRentalDays(startISO: string, dueISO: string): number {
  return Math.max(0, daysBetween(startISO, dueISO) - RENTAL_DAYS);
}

/** Fee for booking a rental longer than the standard week: $EXTRA_DAY_RATE for
 *  each day past 7 (kept by Borrow, like a late fee — not shared with consignors). */
export function extraRentalFee(startISO: string, dueISO: string): number {
  return extraRentalDays(startISO, dueISO) * EXTRA_DAY_RATE;
}

/**
 * How many days before a reservation's pickup a piece must stop taking NEW
 * rentals, so a reserved piece is guaranteed back, cleaned, and ready. A flat,
 * configurable protection window (default 14) — wide enough to cover the
 * standard week, cleaning, and a generous cushion.
 */
export function lastSafeRentalLeadDays(p: {
  reservation_protect_days: number;
}): number {
  return Math.max(0, Math.floor(Number(p.reservation_protect_days) || 0));
}

/**
 * The Last Safe Rental Date (YYYY-MM-DD) for a reservation picked up on
 * `pickupISO`: pickup minus the lead days. On/before this date a new rental is
 * safe; the day AFTER it, the piece must be held for the reservation.
 */
export function lastSafeRentalDate(pickupISO: string, leadDays: number): string {
  // noon UTC keeps the date-only arithmetic clear of any DST edges.
  const d = new Date(pickupISO.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - leadDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Going-forward pricing model: a piece's suggested weekly rental price is its
 * retail value divided by 4, rounded to the nearest whole dollar. This is only
 * ever a SUGGESTION surfaced in the piece form — never auto-applied. Returns
 * null when there's no usable retail value.
 */
export function suggestedRentalPrice(
  retailValue: number | null | undefined
): number | null {
  const r = Number(retailValue);
  if (!Number.isFinite(r) || r <= 0) return null;
  return Math.round(r / 4);
}

/** Rental agreement terms shown at checkout and included in the receipt. */
export const AGREEMENT_TERMS = [
  "Pieces are rented for a 7-day window and are due back by the due date.",
  "Every rental price already includes the Cleaning & Care Fee — professional cleaning between wears is on us. Please do not clean the item yourself; return it as-is and Borrow takes care of all cleaning. This is not damage insurance.",
  "The renter authorizes Borrow to charge the payment method on file $15 per item per day for each day an item is returned past its due date.",
  "The renter authorizes Borrow to charge the payment method on file for the cost of repairing any item damaged beyond normal wear, or the item's recorded replacement value if it is not returned or is damaged beyond repair.",
  "Each rental includes a hanger. The renter authorizes Borrow to charge the payment method on file a fee for any hanger not returned with the item, as listed at checkout.",
  "Reservations are paid in full to hold the piece. A reservation canceled 48 or more hours before the scheduled pickup is refunded the rental price; tax is non-refundable. Cancellations within 48 hours of pickup, no-shows, and cancellations after pickup are non-refundable.",
];

/**
 * Consignor agreement terms — shown when setting up / managing a consignor.
 * Rate-parameterized: the exact %/split reflects the consignor's own rate so
 * the signed snapshot always matches what they agreed to.
 */
export function consignorAgreementTerms(ratePct: number): string[] {
  const r = Math.round(ratePct);
  return [
    `You earn ${r}% of the rental price on each completed rental of your pieces; Borrow keeps ${100 - r}%. Any late fees are retained by Borrow.`,
    "Consigned items are rented to third parties who may damage, stain, or fail to return them, and you accept this risk. Each item is assigned an agreed replacement value at intake. If an item is lost or damaged beyond repair, Borrow will pay you that agreed replacement value on your next scheduled payout, regardless of whether Borrow recovers the amount from the renter. Repairable damage does not trigger a replacement payout; Borrow will repair the item and it remains in your consigned inventory.",
  ];
}
export const CONSIGNOR_AGREEMENT_TERMS = consignorAgreementTerms(DEFAULT_CONSIGNOR_RATE);

/**
 * The signed Consignor Agreement. Bump the version whenever the body changes so
 * a re-signature can be required. `body` is the exact text a consignor agrees to.
 */
export const CONSIGNOR_AGREEMENT_VERSION = "2026-07-17";
export const CONSIGNOR_AGREEMENT_TITLE = "Consignor Agreement";
export const CONSIGNOR_AGREEMENT_INTRO =
  "By consigning items to Borrow, you agree to the following:";
export function consignorAgreementBody(ratePct: number): string[] {
  const r = Math.round(ratePct);
  return [
    `Borrow will list your approved items for rental and pay you ${r}% of the rental price each time an item rents, on Borrow's regular payout schedule.`,
    "At intake, each item is assigned an agreed replacement value, shown to you and confirmed before the item is listed. This value represents the item's fair value if it is lost or damaged beyond repair.",
    "Your items will be rented to third parties (renters), who may occasionally damage or fail to return an item despite Borrow's rental agreement and safeguards. You accept this risk as a condition of consigning.",
    "If an item is lost or damaged beyond repair, Borrow will pay you its agreed replacement value on your next scheduled payout, regardless of whether Borrow successfully collects that amount from the renter responsible.",
    "If an item sustains repairable damage, Borrow will have it repaired at Borrow's expense; no replacement payout applies, and the item remains in your consigned inventory once repaired.",
    "You may retrieve any of your items at any time, provided the item is not currently rented out or reserved.",
    "Borrow may decline to accept any item, at its discretion.",
  ];
}
export const CONSIGNOR_AGREEMENT_BODY = consignorAgreementBody(DEFAULT_CONSIGNOR_RATE);

export interface Transaction {
  id: number;
  customer_id: number | null;
  customer_name?: string | null;
  piece_count: number;
  subtotal: number;
  waiver_total: number;
  total: number;
  start_date: string;
  due_date: string;
  payment_method: string;
  payment_status: "collected" | "pending" | "void";
  payment_ref: string | null;
  agreement_accepted: boolean;
  agreement_name: string | null;
  agreement_accepted_at: string | null;
  receipt_email: string | null;
  created_at: string;
}

export type RentalStatus = "reserved" | "active" | "completed" | "cancelled";

export interface Payout {
  id: number;
  consignor_id: number;
  amount: number;
  method: string | null;
  notes: string | null;
  paid_at: string;
}

export interface ConsignorCharge {
  id: number;
  consignor_id: number;
  amount: number;
  kind: "retrieval" | "initial";
  item_id: string | null;
  note: string | null;
  charged_on: string;
  created_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  flag: "vip" | "problem" | null;
  notes: string | null;
  store_credit: number;
}

export interface StoreCreditEntry {
  id: number;
  customer_id: number;
  amount: number; // + grant, - redemption
  reason: string;
  rental_id: number | null;
  transaction_id: number | null;
  created_at: string;
}

export type AmbassadorTier = "curator" | "poster";
export type AmbassadorStatus = "active" | "inactive";

export interface Ambassador {
  id: number;
  name: string;
  instagram: string | null;
  phone: string | null;
  sorority: string | null;
  tier: AmbassadorTier;
  status: AmbassadorStatus;
  join_date: string; // YYYY-MM-DD
  referral_code: string;
  active_months: string[]; // posters rotate monthly — months they're active
  customer_id: number | null;
  consignor_id: number | null;
  notes: string | null;
  created_at: string;
  // monthly perk-credit counters (reset on the 1st; see lib/credits.ts)
  credit_period: string | null;
  free_used: number;
  rate_used: number;
  bonus_earned: number;
  bonus_used: number;
}

/** Remaining perk credits for the current month, after a lazy reset. */
export interface AmbassadorCredits {
  free: number; // base free rentals remaining
  rate: number; // $6-rate rentals remaining
  bonus: number; // earned bonus free rentals remaining
}

/** Configurable ambassador-program settings (stored in app_settings). */
export interface AmbassadorProgram {
  credits: {
    curator: { free: number; rate: number };
    poster: { free: number; rate: number };
  };
  cleaning_rate: number; // the "$6" ambassador rate
  cleaning_fee: number; // consignor initial / at-retrieval dry-clean charge (NOT a renter fee — renter cleaning is already included in the rental price)
  retrieval_cleaning_fee: number; // deducted from a consignor's earnings when a retrieval completes (Borrow cleans before returning)
  blackout_dates: string[]; // YYYY-MM-DD; perks suppressed on these days
  store_closed_dates: string[]; // YYYY-MM-DD; studio closed — no pickup, reservation, or return may land on these days
  store_closed_weekdays: number[]; // 0=Sun … 6=Sat; studio closed every one of these weekdays (recurring), same rules as store_closed_dates
  posting_target: number; // posts expected per ambassador per month
  post_credit: number; // store credit a customer earns for posting a rental
  terminal_reader_id: string; // Stripe Terminal reader for in-person tap charges
  hanger_fee: number; // charged if the hanger isn't returned
  garment_bag_fee: number; // charged if the garment bag isn't returned
  turnaround_days: number; // cleaning/turnaround buffer after a return before re-bookable
  reservation_protect_days: number; // days before a reservation's pickup that the piece stops taking new rentals, so it's guaranteed available
  hold_notice_lead_days: number; // days before a consignor hold's start date to start reminding the owner to pull the piece (a conflict surfaces immediately regardless)
  sales_tax_rate: number; // % applied to the rental price (NOT the cleaning fee)
  reservations_open: string; // YYYY-MM-DD earliest pickup date customers may book ("" = no limit)
  underperformance_days: number; // days without a rental before a piece is flagged underperforming
  storage_window_days: number; // days a piece stays retrievable in storage before it's flagged unclaimed
  approval_batch_window_min: number; // minutes to batch a consignor's new pending items into ONE approval email
  color_swatches: Record<string, string>; // free-text color name (lowercase) → hex, for shop filter swatches
  occasions: Occasion[]; // owner-editable occasion → sub-occasion map powering the shop's "Shop by Occasion" pills
}

// Neutral placeholder for a color name not yet in the map (owner can add its hex
// in Settings). Kept soft-gray so it never looks broken.
export const DEFAULT_SWATCH = "#c9c6c0";

/** Normalize freeform style tags: trim, lowercase, drop blanks/dupes, cap length. */
export function cleanStyleTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(
      v
        .map((s) => String(s).trim().toLowerCase())
        .filter((s) => s.length > 0 && s.length <= 40)
    )
  );
}

/**
 * Occasion / sub-occasion tags — trimmed and de-duped but case-PRESERVED (unlike
 * style tags), since these are display labels like "Wedding Guest" and namespaced
 * subs like "Vacation:Beach".
 */
export function cleanOccasionTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(
      v
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0 && s.length <= 60)
    )
  );
}

export interface Occasion {
  name: string; // top-level occasion label, e.g. "Vacation"
  subs: string[]; // sub-filters under it, e.g. ["Beach","Mountains","City","Poolside"]
}

/** Seed occasions — owner edits these in Settings; sub-occasion tags on pieces
 *  are stored namespaced as "Occasion:Sub". */
export const DEFAULT_OCCASIONS: Occasion[] = [
  { name: "Vacation", subs: ["Beach", "Mountains", "City", "Poolside"] },
  { name: "Formal", subs: ["Mini", "Midi", "Maxi", "Gown"] },
  { name: "Gameday", subs: [] },
  { name: "Date Night", subs: [] },
  { name: "Wedding Guest", subs: ["Daytime", "Evening", "Black Tie"] },
  { name: "Graduation", subs: [] },
];

/** Normalize an occasions config: valid {name, subs[]} entries, de-duped. */
export function cleanOccasions(v: unknown): Occasion[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Occasion[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const name = String((raw as Occasion).name ?? "").trim();
    if (!name || name.length > 60 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const subsRaw = (raw as Occasion).subs;
    const subs = Array.isArray(subsRaw)
      ? Array.from(
          new Set(
            subsRaw
              .map((s) => String(s).trim())
              .filter((s) => s.length > 0 && s.length <= 60)
          )
        )
      : [];
    out.push({ name, subs });
  }
  return out;
}

/** Look up a hex for a free-text color name, tolerating case/whitespace and
 *  falling back to a neutral swatch. Tries the exact name, then its last word
 *  (so "sage green" resolves even if only "green"/"sage" is mapped). */
export function colorToHex(
  name: string,
  map: Record<string, string>
): string {
  const n = name.trim().toLowerCase();
  if (map[n]) return map[n];
  const words = n.split(/\s+/);
  for (const w of [words[words.length - 1], words[0]]) {
    if (w && map[w]) return map[w];
  }
  return DEFAULT_SWATCH;
}

// Sensible starter map (lowercased names → hex). Extend in Settings.
export const DEFAULT_COLOR_SWATCHES: Record<string, string> = {
  black: "#1a1a1a", white: "#ffffff", cream: "#f7f4ef", ivory: "#f3eee2",
  gray: "#9aa0a6", grey: "#9aa0a6", silver: "#c8ccd0", charcoal: "#36393d",
  red: "#c0392b", burgundy: "#6b1f2a", maroon: "#7b2233", wine: "#5e2436",
  pink: "#e59ab0", blush: "#e7c3cc", rose: "#d98ca0", "hot pink": "#e0389a",
  fuchsia: "#c0398b", magenta: "#b5327e", coral: "#f08160", peach: "#f6c1a6",
  orange: "#e67e22", rust: "#b5532a", terracotta: "#c66b4e",
  yellow: "#f2d047", gold: "#c9a227", mustard: "#c9922b",
  green: "#4f8a52", sage: "#a8b677", "sage green": "#a8b677", olive: "#7d7b3a",
  mint: "#a9d8c0", emerald: "#2e8b6f", teal: "#2f8f8a", forest: "#2f4f38",
  blue: "#3b6fb0", navy: "#22304f", "navy blue": "#22304f", "light blue": "#a9c8e8",
  "sky blue": "#a9c8e8", "baby blue": "#bcd6ee", cobalt: "#274bb0", denim: "#4a6a8a",
  purple: "#7a5aa0", lavender: "#c9c3e6", lilac: "#c8b3d9", plum: "#5f3a5f",
  mauve: "#b087a0", violet: "#7d51a3",
  brown: "#6b4a2f", tan: "#c9a884", beige: "#d8c7a9", camel: "#c19a6b",
  taupe: "#b0a291", chocolate: "#4b3325", nude: "#e3c6ac",
  multi: "#b7a9d0", floral: "#d3a5b8", print: "#c2b6a0", metallic: "#bfc2c7",
};

/** Sales tax on a taxable base, given a percent rate; rounded to cents. */
export function salesTax(base: number, ratePct: number): number {
  return Math.round(Number(base) * Number(ratePct)) / 100;
}

/**
 * The studio is closed on some dates (holidays, vacation). A PICKUP can't happen
 * on a closed day (nobody's there to hand the piece over), so that blocks a
 * booking. A RETURN landing on a closed day is fine — the renter just brings it
 * back the next open day (see nextOpenDate), so it never blocks.
 * Returns the closed pickup date (YYYY-MM-DD) if the pickup is closed, else null.
 */
/**
 * Whether the studio is closed on a given day — either it's a one-off closed
 * date (holiday/vacation) OR it falls on a recurring closed weekday (e.g. every
 * Sunday & Monday). Weekday is read at noon UTC so it's tz-stable.
 */
export function isClosedDay(
  dateISO: string,
  closed: string[] | null | undefined,
  closedWeekdays?: number[] | null
): boolean {
  const day = dateISO.slice(0, 10);
  if ((Array.isArray(closed) ? closed : []).includes(day)) return true;
  const wds = Array.isArray(closedWeekdays) ? closedWeekdays : [];
  if (wds.length > 0) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
    if (wds.includes(dow)) return true;
  }
  return false;
}

/**
 * Count the OPEN days a piece is late: days strictly after `dueISO` and strictly
 * before `throughISO` on which the studio was OPEN. Closed days (weekly + one-off)
 * never count — the renter couldn't return then — and `throughISO` itself (today for
 * the cron, the return date at check-in) is excluded since that day isn't over / the
 * piece can still come back.
 */
export function openDaysLate(
  dueISO: string,
  throughISO: string,
  closed: string[] | null | undefined,
  closedWeekdays?: number[] | null
): number {
  const due = dueISO.slice(0, 10);
  const through = throughISO.slice(0, 10);
  if (through <= due) return 0;
  let count = 0;
  const d = new Date(`${due}T12:00:00Z`);
  // step forward day by day, exclusive of both `due` and `through`
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (iso >= through) break;
    if (!isClosedDay(iso, closed, closedWeekdays)) count++;
  }
  return count;
}

export function closedPickupDate(
  startISO: string,
  closed: string[] | null | undefined,
  closedWeekdays?: number[] | null
): string | null {
  const s = startISO.slice(0, 10);
  return isClosedDay(s, closed, closedWeekdays) ? s : null;
}

/**
 * The first day on or after `dateISO` that the studio is open (not closed). Used
 * to roll a return/due date forward off a closed day: "bring it back the next
 * open day." Returns the same date when it's already open.
 */
export function nextOpenDate(
  dateISO: string,
  closed: string[] | null | undefined,
  closedWeekdays?: number[] | null
): string {
  let d = dateISO.slice(0, 10);
  let guard = 0;
  while (isClosedDay(d, closed, closedWeekdays) && guard < 366) {
    const dt = new Date(d + "T12:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + 1);
    d = dt.toISOString().slice(0, 10);
    guard++;
  }
  return d;
}

export const DEFAULT_PROGRAM: AmbassadorProgram = {
  credits: {
    curator: { free: 2, rate: 3 },
    poster: { free: 1, rate: 2 },
  },
  cleaning_rate: 6,
  cleaning_fee: 7,
  retrieval_cleaning_fee: 7,
  blackout_dates: [],
  store_closed_dates: [],
  store_closed_weekdays: [],
  posting_target: 3,
  post_credit: 5,
  terminal_reader_id: "",
  hanger_fee: 5,
  garment_bag_fee: 15,
  turnaround_days: 2,
  reservation_protect_days: 14,
  hold_notice_lead_days: 2,
  sales_tax_rate: 0,
  reservations_open: "2026-07-21",
  underperformance_days: 90,
  storage_window_days: 90,
  approval_batch_window_min: 60,
  color_swatches: DEFAULT_COLOR_SWATCHES,
  occasions: DEFAULT_OCCASIONS,
};

export interface AmbassadorPost {
  id: number;
  ambassador_id: number;
  posted_on: string; // YYYY-MM-DD
  link: string | null;
  note: string | null;
  created_at: string;
}

export interface AmbassadorReferral {
  id: number;
  ambassador_id: number;
  customer_id: number | null;
  transaction_id: number | null;
  customer_name?: string | null;
  created_at: string;
}

/** A piece a Curator proposed, and whether BORROW accepted it. */
export interface AmbassadorProposal {
  id: number;
  ambassador_id: number;
  description: string;
  accepted: boolean;
  created_at: string;
}

export const AMBASSADOR_TIERS: { value: AmbassadorTier; label: string }[] = [
  { value: "curator", label: "Curator" },
  { value: "poster", label: "Poster" },
];

export const AMBASSADOR_STATUSES: { value: AmbassadorStatus; label: string }[] =
  [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ];

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function ambassadorTierLabel(tier: AmbassadorTier): string {
  return AMBASSADOR_TIERS.find((t) => t.value === tier)?.label ?? tier;
}

export interface Rental {
  id: number;
  item_id: string;
  customer_id: number | null;
  start_date: string; // YYYY-MM-DD
  due_date: string;
  returned_date: string | null;
  status: RentalStatus;
  rental_price: number;
  damage_waiver: boolean;
  late_fee: number;
  damaged: boolean;
  notes: string | null;
  damage_kind?: "repair" | "loss" | null;
  repair_cost?: number;
  replacement_value?: number | null; // snapshot at loss time
  payment_followup?: boolean;
  payment_link_url?: string | null;
  source?: string | null; // 'web' | 'checkout' | 'studio' | 'ecloset'
  ecloset_order_id?: string | null;
  ecloset_amount?: number | string | null;
  // joined fields
  customer_name?: string | null;
  brand?: string;
  size?: string;
  color?: string | null;
  photo_url?: string | null;
  item_replacement_value?: number | null; // piece's current replacement value
  ownership?: Ownership;
}

// Tier prices include the 3.99% card-processing markup, rounded UP to a whole
// dollar (base ×1.0399, then ceil) — no stray cents.
export const TIERS: { value: Tier; label: string; price: number }[] = [
  { value: "value", label: "Value", price: 27 },
  { value: "standard", label: "Standard", price: 37 },
  { value: "mid", label: "Mid", price: 47 },
  { value: "high", label: "High", price: 68 },
  { value: "premium", label: "Premium", price: 89 },
];

export const OWNERSHIPS: { value: Ownership; label: string }[] = [
  { value: "owned", label: "Owned" },
  { value: "consignment", label: "Consigned" },
];

export const STATUSES: { value: ItemStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "rented", label: "Rented Out" },
  { value: "consignor_hold", label: "Consignor Hold" },
  { value: "cleaning", label: "Being Cleaned" },
  { value: "with_consignor", label: "With consignor" },
  { value: "in_storage", label: "In Storage" },
  { value: "retired", label: "Retired" },
];

export const SIZES = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
  "00",
  "0",
  "2",
  "4",
  "6",
  "8",
  "10",
  "12",
  "14",
  "16",
  "18",
  "20",
  "22",
  "24",
  "One Size",
];

export const EVENT_TYPES = [
  "Formal",
  "Date Party",
  "Rush",
  "Game Day",
  "Graduation",
  "Wedding Guest",
  "Bridal",
  "Semi-Formal",
  "Night Out",
];

export const COLORS = [
  "Black",
  "White",
  "Ivory / Cream",
  "Beige / Tan",
  "Brown",
  "Red",
  "Pink",
  "Blush",
  "Orange",
  "Yellow",
  "Gold",
  "Green",
  "Sage",
  "Blue",
  "Navy",
  "Purple",
  "Lavender",
  "Silver / Grey",
  "Metallic",
  "Floral / Print",
  "Denim",
  "Multicolor",
];

export const SILHOUETTES = [
  "Mini Dress",
  "Midi Dress",
  "Maxi Dress",
  "Gown",
  "Matching Set",
  "Top",
  "Skirt",
  "Shorts",
  "Pants",
  "Jumpsuit",
  "Co-ord",
  "Outerwear",
  "Accessory",
];

export function tierLabel(tier: Tier): string {
  return TIERS.find((t) => t.value === tier)?.label ?? tier;
}

export function statusLabel(status: ItemStatus): string {
  return STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function ownershipLabel(ownership: Ownership): string {
  return OWNERSHIPS.find((o) => o.value === ownership)?.label ?? ownership;
}
