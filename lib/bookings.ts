import { sql } from "@/lib/db";
import { getProgram } from "@/lib/credits";

export interface BookingInput {
  item_id: string;
  customer_id: number | null;
  start_date: string;
  due_date: string;
  rental_price: number;
  damage_waiver: boolean;
  notes: string | null;
  source: "studio" | "web";
}

export type BookingResult =
  | { ok: true; rental: Record<string, unknown> }
  | { ok: false; status: number; error: string; conflicts?: unknown[] };

/**
 * Single entry point for creating a booking — used by both the studio
 * dashboard and the public (customer-site) API so the double-booking
 * guard can never be bypassed.
 */
export async function createBooking(b: BookingInput): Promise<BookingResult> {
  if (!b.item_id || !b.start_date || !b.due_date || b.rental_price == null) {
    return {
      ok: false,
      status: 400,
      error: "item_id, start_date, due_date and rental_price are required",
    };
  }
  if (b.due_date < b.start_date) {
    return {
      ok: false,
      status: 400,
      error: "Due date can't be before the pickup date",
    };
  }

  const item = await sql`SELECT id, status FROM items WHERE id = ${b.item_id}`;
  if (item.length === 0) {
    return { ok: false, status: 404, error: "Piece not found" };
  }
  if (item[0].status === "retired") {
    return { ok: false, status: 400, error: "This piece is retired" };
  }

  const conflicts = await sql`
    SELECT r.id, r.start_date, r.due_date, c.name AS customer_name
    FROM rentals r
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.item_id = ${b.item_id}
      AND r.status IN ('reserved','active')
      AND r.start_date <= ${b.due_date}
      AND r.due_date >= ${b.start_date}
  `;
  if (conflicts.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "This piece is already booked for those dates",
      conflicts,
    };
  }

  // The Cleaning & Care Fee is charged when the waiver flag is set; store the
  // actual configured amount so finances reflect it (see app/api/finances).
  const fee = b.damage_waiver ? (await getProgram()).cleaning_fee : 0;
  const rows = await sql`
    INSERT INTO rentals (
      item_id, customer_id, start_date, due_date, status,
      rental_price, damage_waiver, cleaning_fee, notes, source
    ) VALUES (
      ${b.item_id}, ${b.customer_id}, ${b.start_date}, ${b.due_date},
      'reserved', ${b.rental_price}, ${b.damage_waiver}, ${fee}, ${b.notes}, ${b.source}
    )
    RETURNING *
  `;

  await sql`
    UPDATE items SET status = 'reserved', updated_at = now()
    WHERE id = ${b.item_id} AND status = 'available'
  `;

  return { ok: true, rental: rows[0] };
}

/** Find a customer by phone/email or create one. Used by the public booking API. */
export async function findOrCreateCustomer(c: {
  name: string;
  phone?: string | null;
  email?: string | null;
}): Promise<number> {
  const phone = c.phone?.trim() || null;
  const email = c.email?.trim().toLowerCase() || null;

  if (phone || email) {
    const existing = await sql`
      SELECT id FROM customers
      WHERE (${phone}::text IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') = regexp_replace(${phone}::text, '\\D', '', 'g'))
         OR (${email}::text IS NOT NULL AND lower(email) = ${email}::text)
      LIMIT 1
    `;
    if (existing.length > 0) return existing[0].id;
  }

  const rows = await sql`
    INSERT INTO customers (name, phone, email)
    VALUES (${c.name.trim()}, ${phone}, ${email})
    RETURNING id
  `;
  return rows[0].id;
}
