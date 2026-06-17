import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendReceipt, ReceiptLine } from "@/lib/email";
import { DAMAGE_WAIVER } from "@/lib/types";

interface CheckoutBody {
  customer_id?: number | null;
  item_ids?: string[];
  start_date?: string;
  due_date?: string;
  agreement_accepted?: boolean;
  agreement_name?: string;
  receipt_email?: string;
  payment_method?: string;
  payment_ref?: string;
}

/**
 * Point-of-sale checkout: links one or more available pieces to a customer for
 * a rental window, records the (externally collected) payment as one
 * transaction, marks each piece Rented Out, and emails a receipt + agreement.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = (await request.json()) as CheckoutBody;

  const itemIds = Array.isArray(b.item_ids) ? b.item_ids.filter(Boolean) : [];
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "Add at least one piece." }, { status: 400 });
  }
  if (!b.start_date || !b.due_date) {
    return NextResponse.json(
      { error: "start_date and due_date are required." },
      { status: 400 }
    );
  }
  if (b.due_date < b.start_date) {
    return NextResponse.json(
      { error: "Due date can't be before the start date." },
      { status: 400 }
    );
  }
  if (!b.agreement_accepted) {
    return NextResponse.json(
      { error: "The rental agreement must be accepted." },
      { status: 400 }
    );
  }

  // Load the pieces and verify each can be rented.
  const items = await sql`
    SELECT id, brand, barcode, rental_price, status
    FROM items WHERE id = ANY(${itemIds})
  `;
  if (items.length !== itemIds.length) {
    return NextResponse.json(
      { error: "One or more pieces could not be found." },
      { status: 400 }
    );
  }
  const unavailable = items.filter(
    (i) => i.status !== "available" && i.status !== "reserved"
  );
  if (unavailable.length > 0) {
    const names = unavailable
      .map((i) => `${i.brand} (${i.barcode || i.id})`)
      .join(", ");
    return NextResponse.json(
      { error: `Not available for checkout: ${names}` },
      { status: 409 }
    );
  }

  // Guard against date overlaps with existing live bookings.
  const conflicts = await sql`
    SELECT item_id FROM rentals
    WHERE item_id = ANY(${itemIds})
      AND status IN ('reserved','active')
      AND start_date <= ${b.due_date}
      AND due_date >= ${b.start_date}
  `;
  if (conflicts.length > 0) {
    return NextResponse.json(
      { error: "One or more pieces are already booked for those dates." },
      { status: 409 }
    );
  }

  const subtotal = items.reduce((s, i) => s + Number(i.rental_price), 0);
  const waiverTotal = items.length * DAMAGE_WAIVER;
  const total = subtotal + waiverTotal;

  // One transaction row for the whole checkout.
  const txRows = await sql`
    INSERT INTO transactions (
      customer_id, piece_count, subtotal, waiver_total, total,
      start_date, due_date, payment_method, payment_status, payment_ref,
      agreement_accepted, agreement_name, agreement_accepted_at, receipt_email
    ) VALUES (
      ${b.customer_id ?? null}, ${items.length}, ${subtotal}, ${waiverTotal}, ${total},
      ${b.start_date}, ${b.due_date}, ${b.payment_method || "card_reader"},
      'collected', ${b.payment_ref || null},
      true, ${b.agreement_name || null}, now(), ${b.receipt_email || null}
    )
    RETURNING *
  `;
  const tx = txRows[0];

  // One active rental per piece, linked to the transaction, and flip each
  // piece to Rented Out (mirrors the rental "pickup" action).
  for (const item of items) {
    await sql`
      INSERT INTO rentals (
        item_id, customer_id, start_date, due_date, status,
        rental_price, damage_waiver, source, transaction_id
      ) VALUES (
        ${item.id}, ${b.customer_id ?? null}, ${b.start_date}, ${b.due_date},
        'active', ${item.rental_price}, true, 'checkout', ${tx.id}
      )
    `;
    await sql`
      UPDATE items SET status = 'rented', rental_count = rental_count + 1, updated_at = now()
      WHERE id = ${item.id}
    `;
  }

  // Receipt email (best-effort; checkout already succeeded).
  let emailSent = false;
  const recipient =
    b.receipt_email ||
    (b.customer_id
      ? (
          await sql`SELECT email FROM customers WHERE id = ${b.customer_id}`
        )[0]?.email
      : null);
  let customerName = b.agreement_name || "";
  if (b.customer_id) {
    const c = await sql`SELECT name FROM customers WHERE id = ${b.customer_id}`;
    customerName = c[0]?.name || customerName;
  }
  if (recipient) {
    const lines: ReceiptLine[] = items.map((i) => ({
      brand: i.brand,
      barcode: i.barcode || i.id,
      rental_price: Number(i.rental_price),
      waiver: DAMAGE_WAIVER,
    }));
    const result = await sendReceipt({
      to: recipient,
      customerName,
      lines,
      subtotal,
      waiverTotal,
      total,
      startDate: b.start_date,
      dueDate: b.due_date,
      agreementName: b.agreement_name || customerName,
      transactionId: tx.id,
    });
    emailSent = result.sent;
  }

  return NextResponse.json(
    { transaction: tx, email_sent: emailSent },
    { status: 201 }
  );
}
