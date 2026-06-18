export type Tier = "standard" | "mid" | "high" | "premium";
export type Ownership = "owned" | "consignment" | "ambassador";
export type ItemStatus =
  | "available"
  | "reserved"
  | "rented"
  | "cleaning"
  | "retired";

export interface Consignor {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface Item {
  id: string;
  barcode: string;
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
  retail_value: number | null; // retail / replacement value
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
  // joined fields
  customer_name?: string | null;
  brand?: string;
  size?: string;
  color?: string | null;
  photo_url?: string | null;
}

export const TIERS: { value: Tier; label: string; price: number }[] = [
  { value: "standard", label: "Standard", price: 35 },
  { value: "mid", label: "Mid", price: 45 },
  { value: "high", label: "High", price: 65 },
  { value: "premium", label: "Premium", price: 85 },
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
  "Semi-Formal",
  "Night Out",
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
