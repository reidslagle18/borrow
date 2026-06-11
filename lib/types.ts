export type Tier = "standard" | "mid" | "premium";
export type Ownership = "owned" | "consignment";
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
  brand: string;
  size: string;
  color: string | null;
  tier: Tier;
  rental_price: number;
  purchase_cost: number | null;
  condition_notes: string | null;
  ownership: Ownership;
  consignor_id: number | null;
  consignor_name?: string | null;
  event_types: string[];
  status: ItemStatus;
  photo_url: string | null;
  rental_count: number;
  created_at: string;
}

/** Consignors earn 60% of each completed rental; BORROW keeps 40%. */
export const CONSIGNOR_SHARE = 0.6;

export type RentalStatus = "reserved" | "active" | "completed" | "cancelled";

export interface Payout {
  id: number;
  consignor_id: number;
  amount: number;
  method: string | null;
  notes: string | null;
  paid_at: string;
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
  { value: "standard", label: "Standard", price: 45 },
  { value: "mid", label: "Mid", price: 65 },
  { value: "premium", label: "Premium", price: 85 },
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
  "Semi-Formal",
  "Date Party",
  "Game Day",
  "Rush",
  "Graduation",
  "Wedding Guest",
  "Night Out",
];

export function tierLabel(tier: Tier): string {
  return TIERS.find((t) => t.value === tier)?.label ?? tier;
}

export function statusLabel(status: ItemStatus): string {
  return STATUSES.find((s) => s.value === status)?.label ?? status;
}
