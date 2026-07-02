export type Tier = "value" | "standard" | "mid" | "high" | "premium";
export type Ownership = "owned" | "consignment" | "ambassador";
export type ItemStatus =
  | "available"
  | "reserved"
  | "rented"
  | "cleaning"
  | "retired"
  | "with_consignor";

export interface Consignor {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  venmo: string | null;
  payout_backup: string | null;
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
  new_with_tags: boolean; // brand new, original retail tags still attached
  ambassador_id: number | null; // ambassador who sourced/brought in the piece
  ambassador_name?: string | null;
  tier: Tier;
  rental_price: number;
  purchase_cost: number | null; // acquisition cost
  retail_value: number | null; // retail value
  // Agreed loss/replacement value charged if the piece is lost or damaged
  // beyond repair. Defaults to max(70% of retail, acquisition cost); once
  // hand-edited, replacement_value_manual stays true and the default is frozen.
  replacement_value: number | null;
  replacement_value_manual: boolean;
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
}

/** Consignors earn 60% of each completed rental; BORROW keeps 40%. */
export const CONSIGNOR_SHARE = 0.6;

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

/**
 * Default Cleaning & Care Fee added to every paying rental, in dollars.
 * The live amount is configurable via the ambassador-program settings
 * (program.cleaning_fee); this is only the fallback default.
 */
export const CLEANING_FEE_DEFAULT = 6;

/** Standard rental window, in days. */
export const RENTAL_DAYS = 7;

/** Rental agreement terms shown at checkout and included in the receipt. */
export const AGREEMENT_TERMS = [
  "Pieces are rented for a 7-day window and are due back by the due date.",
  "A Cleaning & Care Fee is added to every paying rental.",
  "The Cleaning & Care Fee covers professional cleaning and standard handling only. It is not damage insurance. The renter is responsible for the cost of repairing or replacing any item that is damaged beyond normal wear, stained beyond cleaning, lost, or not returned, up to the item's full replacement value.",
  "Late returns are charged $15 per piece per day past the due date.",
  "If an item is not returned, or is returned damaged beyond repair, the renter authorizes Borrow to charge the payment method on file the item's replacement value as recorded at the time of rental. The replacement value reflects the fair value of the item.",
];

/** Consignor agreement terms — shown when setting up / managing a consignor. */
export const CONSIGNOR_AGREEMENT_TERMS = [
  "You earn 60% of the rental price on each completed rental of your pieces; Borrow keeps 40%. The Cleaning & Care Fee and any late fees are retained by Borrow.",
  "Consigned items are rented to third parties who may damage, stain, or fail to return them, and you accept this risk. Each item is assigned an agreed replacement value at intake. If an item is lost or damaged beyond repair, Borrow will pay you that agreed replacement value on your next scheduled payout, regardless of whether Borrow recovers the amount from the renter. Repairable damage does not trigger a replacement payout; Borrow will repair the item and it remains in your consigned inventory.",
];

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
  cleaning_fee: number; // Cleaning & Care Fee added to every paying rental
  blackout_dates: string[]; // YYYY-MM-DD; perks suppressed on these days
  posting_target: number; // posts expected per ambassador per month
  post_credit: number; // store credit a customer earns for posting a rental
  terminal_reader_id: string; // Stripe Terminal reader for in-person tap charges
}

export const DEFAULT_PROGRAM: AmbassadorProgram = {
  credits: {
    curator: { free: 2, rate: 3 },
    poster: { free: 1, rate: 2 },
  },
  cleaning_rate: 6,
  cleaning_fee: 6,
  blackout_dates: [],
  posting_target: 3,
  post_credit: 5,
  terminal_reader_id: "",
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
  { value: "ambassador", label: "Ambassador" },
];

export const STATUSES: { value: ItemStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "rented", label: "Rented Out" },
  { value: "cleaning", label: "Being Cleaned" },
  { value: "with_consignor", label: "With consignor" },
  { value: "retired", label: "Retired" },
];

export const SIZES = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "0",
  "2",
  "4",
  "6",
  "8",
  "10",
  "12",
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
  "Multicolor",
];

export const SILHOUETTES = [
  "Mini Dress",
  "Midi Dress",
  "Maxi Dress",
  "Gown",
  "Two-Piece",
  "Top",
  "Skirt",
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
