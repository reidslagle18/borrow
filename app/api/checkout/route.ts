import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendReceipt, sendConsignorRentedEmail, ReceiptLine } from "@/lib/email";
import { consignorShare, salesTax, extraRentalFee, closedPickupDate, nextOpenDate } from "@/lib/types";
import { getProgram } from "@/lib/credits";
import { activeCampaignForCode } from "@/lib/campaigns";
import { todayISO } from "@/lib/dates";

interface CheckoutBody {
  customer_id?: number | null;
  item_ids?: string[];
  start_date?: string;
  due_date?: string;
  agreement_accepted?: boolean;
  agreement_name?: string;
  charge_auth_accepted?: boolean;
  receipt_email?: string;
  payment_method?: string;
  payment_ref?: string;
  stripe_customer_id?: string;
  stripe_payment_method_id?: string;
  campaign_code?: string | null;
  // "terminal" → payment is collected on the tap reader right after this call,
  // so the transaction starts as pending and its rentals start unpaid; the
  // Terminal poll endpoint flips both once the tap succeeds.
  payment_mode?: "terminal" | "manual";
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
  // A closed PICKUP day is blocked (nobody's there to hand it over). A closed
  // RETURN day is fine — roll the due date to the next open day (bring it back
  // then) at no penalty. The extra-day fee is computed on the ORIGINAL due, so
  // the closure roll is never charged.
  const closeProg = await getProgram();
  const closedPickup = closedPickupDate(
    b.start_date,
    closeProg.store_closed_dates,
    closeProg.store_closed_weekdays
  );
  if (closedPickup) {
    return NextResponse.json(
      { error: `The studio is closed on ${closedPickup}, so the pickup can't be that day. Pick a different start date.` },
      { status: 409 }
    );
  }
  const originalDueDate = b.due_date;
  b.due_date = nextOpenDate(b.due_date, closeProg.store_closed_dates, closeProg.store_closed_weekdays);
  if (!b.agreement_accepted) {
    return NextResponse.json(
      { error: "The rental agreement must be accepted." },
      { status: 400 }
    );
  }
  if (!b.charge_auth_accepted) {
    return NextResponse.json(
      { error: "The automatic-charge authorization must be accepted." },
      { status: 400 }
    );
  }

  // Load the pieces and verify each can be rented.
  const items = await sql`
    SELECT id, COALESCE(NULLIF(name, ''), brand) AS brand, barcode, rental_price, status, ownership, consignor_id
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

  const program = await getProgram();

  // Reservation guard (in-store): a reserved piece CAN be rented out, as long as
  // this rental is returned AND cleaned (turnaround) before the reservation's
  // pickup. Only blocks when the actual dates wouldn't leave that cleaning gap —
  // not a blanket days-out cutoff. (Raw date overlaps are already caught above.)
  const turnaround = Math.max(0, Math.floor(Number(program.turnaround_days) || 0));
  for (const item of items) {
    const reservedFor = (
      await sql`
        SELECT to_char(MIN(r.start_date), 'YYYY-MM-DD') AS pickup
        FROM rentals r
        WHERE r.item_id = ${item.id}
          AND r.status = 'reserved'
          AND r.start_date >= (now() AT TIME ZONE 'America/Chicago')::date
          AND ${b.start_date}::date <= r.start_date
          AND (${b.due_date}::date + ${turnaround}::int) >= r.start_date
      `
    )[0]?.pickup as string | undefined;
    if (reservedFor) {
      return NextResponse.json(
        {
          error: `${item.brand} is reserved for ${reservedFor} — rent it out only if it's returned and cleaned before then.`,
        },
        { status: 409 }
      );
    }
  }

  // Each piece rents at its price (Cleaning & Care Fee already included). A
  // rental booked longer than the standard week adds $EXTRA_DAY_RATE per item
  // for each extra day (kept by Borrow, like a late fee — not consignor-shared).
  const extraFeePerPiece = extraRentalFee(b.start_date, originalDueDate);
  type Plan = { item: (typeof items)[number]; charge: number; extraFee: number; kind: string };
  const plan: Plan[] = items.map((item) => ({
    item,
    charge: Number(item.rental_price),
    extraFee: extraFeePerPiece,
    kind: "full",
  }));

  const subtotal = plan.reduce((s, p) => s + p.charge, 0);
  const extraFeeTotal = plan.reduce((s, p) => s + p.extraFee, 0);
  const waiverTotal = 0; // Cleaning & Care Fee is already included in the rental price.
  const taxTotal = salesTax(subtotal, program.sales_tax_rate);
  const grossTotal = subtotal + extraFeeTotal + taxTotal;

  // Apply any store credit the customer has, up to the order total.
  let creditApplied = 0;
  if (b.customer_id) {
    const cust = await sql`SELECT store_credit FROM customers WHERE id = ${b.customer_id}`;
    const bal = Number(cust[0]?.store_credit ?? 0);
    creditApplied = Math.min(bal, grossTotal);
  }
  const total = grossTotal - creditApplied;

  // In-person tap is collected on the reader right after this call; everything
  // else is treated as already collected (online/manual/card-on-file).
  const isTerminal = b.payment_mode === "terminal";
  const paymentStatus = isTerminal ? "pending" : "collected";
  const paymentMethod = isTerminal ? "terminal" : b.payment_method || "card_reader";

  // A future pickup date is a RESERVATION: they pay in full now to hold the
  // piece, it shows as "Reserved" (not rented) until they come in and it's
  // marked picked up, and it's covered by the 48-hour cancellation refund.
  // A same-day checkout is an immediate rental (piece goes straight to Rented).
  const reserving = b.start_date > todayISO();

  // One transaction row for the whole checkout.
  const txRows = await sql`
    INSERT INTO transactions (
      customer_id, piece_count, subtotal, waiver_total, tax_total, total, store_credit_applied,
      start_date, due_date, payment_method, payment_status, payment_ref,
      agreement_accepted, agreement_name, agreement_accepted_at,
      charge_auth_accepted, charge_auth_accepted_at, receipt_email
    ) VALUES (
      ${b.customer_id ?? null}, ${items.length}, ${subtotal}, ${waiverTotal}, ${taxTotal}, ${total},
      ${creditApplied}, ${b.start_date}, ${b.due_date}, ${paymentMethod},
      ${paymentStatus}, ${b.payment_ref || null},
      true, ${b.agreement_name || null}, now(),
      true, now(), ${b.receipt_email || null}
    )
    RETURNING *
  `;
  const tx = txRows[0];

  // Deduct the redeemed store credit and log it against the transaction.
  if (creditApplied > 0 && b.customer_id) {
    await sql`UPDATE customers SET store_credit = store_credit - ${creditApplied} WHERE id = ${b.customer_id}`;
    await sql`
      INSERT INTO store_credit_entries (customer_id, amount, reason, transaction_id)
      VALUES (${b.customer_id}, ${-creditApplied}, 'redeem', ${tx.id})
    `;
  }

  // Campaign tag (no discount / no price change — just flags the order). Only
  // applies if the code is a campaign active for today's payment date.
  const campaign = await activeCampaignForCode(b.campaign_code);
  const campaignCode = campaign?.code ?? null;

  // One active rental per piece, linked to the transaction, and flip each
  // piece to Rented Out (mirrors the rental "pickup" action).
  for (const p of plan) {
    await sql`
      INSERT INTO rentals (
        item_id, customer_id, start_date, due_date, status,
        rental_price, damage_waiver, cleaning_fee, extra_days_fee, sales_tax, source, transaction_id,
        stripe_customer_id, stripe_payment_method_id, paid, campaign_code
      ) VALUES (
        ${p.item.id}, ${b.customer_id ?? null}, ${b.start_date}, ${b.due_date},
        ${reserving ? "reserved" : "active"}, ${p.charge}, false, 0, ${p.extraFee},
        ${salesTax(p.charge, program.sales_tax_rate)}, 'checkout', ${tx.id},
        ${b.stripe_customer_id || null}, ${b.stripe_payment_method_id || null}, ${!isTerminal}, ${campaignCode}
      )
    `;
    // Reserved pieces are held (not counted as a rental yet); the pickup action
    // bumps the count and flips them to Rented when the customer collects.
    if (reserving) {
      await sql`
        UPDATE items SET status = 'reserved', updated_at = now()
        WHERE id = ${p.item.id}
      `;
    } else {
      await sql`
        UPDATE items SET status = 'rented', rental_count = rental_count + 1, updated_at = now()
        WHERE id = ${p.item.id}
      `;
    }
  }

  // Log the campaign tag on this order (audit trail).
  if (campaignCode) {
    await sql`
      INSERT INTO campaign_tag_log (transaction_id, code, action, actor)
      VALUES (${tx.id}, ${campaignCode}, 'checkout', 'in-store checkout')
    `.catch(() => {});
  }

  // Notify consignors whose pieces just rented (best-effort, free email). For a
  // reservation we hold this until the piece is actually picked up (the pickup
  // action sends it then), so consignors aren't told it rented before it goes out.
  const consigned = reserving
    ? []
    : await sql`
    SELECT COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.rental_price, c.name, c.email, c.portal_code, c.consignor_rate
    FROM items i JOIN consignors c ON c.id = i.consignor_id
    WHERE i.id = ANY(${itemIds}) AND i.ownership = 'consignment' AND c.email IS NOT NULL
  `;
  for (const c of consigned) {
    const r = await sendConsignorRentedEmail({
      to: c.email,
      consignorName: c.name,
      brand: c.brand,
      earned: Math.round(Number(c.rental_price) * consignorShare(c.consignor_rate) * 100) / 100,
      portalCode: c.portal_code ?? null,
    });
    console.log(`[checkout] consignor email to ${c.email}:`, JSON.stringify(r));
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
    const lines: ReceiptLine[] = plan.map((p) => ({
      brand: p.item.brand,
      barcode: p.item.barcode || p.item.id,
      rental_price: p.charge,
      waiver: 0,
    }));
    const result = await sendReceipt({
      to: recipient,
      customerName,
      lines,
      subtotal,
      waiverTotal,
      extraFeeTotal,
      total,
      creditApplied,
      startDate: b.start_date,
      dueDate: b.due_date,
      agreementName: b.agreement_name || customerName,
      transactionId: tx.id,
    });
    emailSent = result.sent;
    console.log(`[checkout] receipt email to ${recipient}:`, JSON.stringify(result));
  } else {
    console.log("[checkout] no receipt recipient (no email on customer/order)");
  }

  return NextResponse.json(
    {
      transaction: tx,
      email_sent: emailSent,
      credit_applied: creditApplied,
      credit_remaining:
        b.customer_id != null
          ? Math.max(
              0,
              Math.round(
                (Number(
                  (
                    await sql`SELECT store_credit FROM customers WHERE id = ${b.customer_id}`
                  )[0]?.store_credit ?? 0
                )) * 100
              ) / 100
            )
          : 0,
      breakdown: plan.map((p) => ({
        barcode: p.item.barcode || p.item.id,
        kind: p.kind,
        charge: p.charge,
      })),
    },
    { status: 201 }
  );
}
