import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendConsignorRentedEmail } from "@/lib/email";

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Manually log one e.closet order: pick the piece + the rental dates. Creates a
 * reserved e.closet rental (blocks the dates on Borrow), flags the piece as
 * listed_on_ecloset, and queues the consignor's payout — same as a CSV import,
 * for when e.closet's export doesn't carry the dress or dates.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const itemId = String(b.item_id ?? "").trim();
  const start = b.start_date;
  const due = b.due_date;
  if (!itemId || !isDate(start) || !isDate(due)) {
    return NextResponse.json({ error: "Pick a piece and both dates." }, { status: 400 });
  }
  if (due < start) {
    return NextResponse.json({ error: "Return date can't be before pickup." }, { status: 400 });
  }

  const items = await sql`
    SELECT id, COALESCE(NULLIF(name,''), brand) AS name, rental_price, ownership, consignor_id, status
    FROM items WHERE id = ${itemId}`;
  if (!items.length) return NextResponse.json({ error: "Piece not found." }, { status: 404 });
  const it = items[0];

  const orderId = b.order_id ? String(b.order_id).trim() : null;
  if (orderId) {
    const dup = await sql`SELECT id FROM rentals WHERE ecloset_order_id = ${orderId} LIMIT 1`;
    if (dup.length) {
      return NextResponse.json({ error: `Order ${orderId} is already in Borrow.` }, { status: 409 });
    }
  }

  const price = Number(it.rental_price) || 0;
  const amount = b.amount != null && b.amount !== "" ? Number(b.amount) : null;
  const notes =
    `e.closet${orderId ? ` order ${orderId}` : ""}` +
    `${b.buyer ? ` · ${String(b.buyer).trim()}` : ""}` +
    `${amount != null ? ` · charged $${amount}` : ""}`;

  const ins = await sql`
    INSERT INTO rentals (
      item_id, customer_id, start_date, due_date, status,
      rental_price, damage_waiver, cleaning_fee, sales_tax, notes, source,
      paid, ecloset_order_id, ecloset_amount
    ) VALUES (
      ${itemId}, ${null}, ${start}, ${due}, 'reserved',
      ${price}, false, 0, 0, ${notes}, 'ecloset',
      true, ${orderId}, ${amount}
    )
    ON CONFLICT (ecloset_order_id) WHERE ecloset_order_id IS NOT NULL DO NOTHING
    RETURNING id
  `;
  if (!ins.length) {
    return NextResponse.json({ error: "That order is already in Borrow." }, { status: 409 });
  }
  const rentalId = Number(ins[0].id);

  await sql`UPDATE items SET listed_on_ecloset = true, updated_at = now() WHERE id = ${itemId}`;
  await sql`UPDATE items SET status = 'reserved', updated_at = now() WHERE id = ${itemId} AND status = 'available'`;

  // The consignor payout is NOT queued now — it fires when the rental returns
  // (just like an in-store order), via the settle cron. Here we compute what it
  // WILL be (their normal in-store cut) and email the consignor that it rented.
  let payout = 0;
  let consignorName: string | null = null;
  if (it.ownership === "consignment" && it.consignor_id) {
    const c = await sql`SELECT name, email, portal_code, COALESCE(consignor_rate,60) AS rate FROM consignors WHERE id = ${it.consignor_id}`;
    const rate = Number(c[0]?.rate ?? 0);
    consignorName = c[0]?.name ?? null;
    payout = Math.round(price * (rate / 100) * 100) / 100;
    if (c[0]?.email) {
      await sendConsignorRentedEmail({
        to: c[0].email,
        consignorName: consignorName ?? "",
        brand: String(it.name),
        earned: payout,
        portalCode: c[0].portal_code ?? null,
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    rental_id: rentalId,
    piece: it.name,
    payout,
    consignor_name: consignorName,
  });
}
