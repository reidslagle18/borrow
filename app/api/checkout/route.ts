import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendReceipt, sendConsignorRentedEmail, ReceiptLine } from "@/lib/email";
import { CONSIGNOR_SHARE } from "@/lib/types";
import {
  getProgram,
  ensureCurrentPeriod,
  remainingCredits,
  isBlackout,
} from "@/lib/credits";

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
  referral_code?: string;
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

  // --- Ambassador perk credits ---------------------------------------------
  // If the customer is a linked ambassador (and the start date isn't a peak
  // blackout day), apply credits per piece: free, then bonus (also free), then
  // the $6 cleaning rate, then full price. Pricier pieces get the free credits
  // first to maximize the ambassador's benefit.
  type Plan = { item: (typeof items)[number]; charge: number; waiver: boolean; kind: string };
  let plan: Plan[];
  let ambassador: { id: number } | null = null;
  const program = await getProgram();
  const blackout = isBlackout(b.start_date, program);

  let amb = b.customer_id
    ? (await sql`SELECT * FROM ambassadors WHERE customer_id = ${b.customer_id} LIMIT 1`)[0]
    : null;

  if (amb && !blackout) {
    amb = await ensureCurrentPeriod(amb);
    const rem = remainingCredits(amb, program);
    let { free, bonus, rate } = rem;
    let freeUsed = 0,
      bonusUsed = 0,
      rateUsed = 0;
    ambassador = { id: amb.id };

    const ordered = [...items].sort(
      (a, c) => Number(c.rental_price) - Number(a.rental_price)
    );
    plan = ordered.map((item) => {
      if (free > 0) {
        free--;
        freeUsed++;
        return { item, charge: 0, waiver: false, kind: "free" };
      }
      if (bonus > 0) {
        bonus--;
        bonusUsed++;
        return { item, charge: 0, waiver: false, kind: "bonus" };
      }
      if (rate > 0) {
        rate--;
        rateUsed++;
        return { item, charge: program.cleaning_rate, waiver: false, kind: "rate" };
      }
      return { item, charge: Number(item.rental_price), waiver: true, kind: "full" };
    });

    await sql`
      UPDATE ambassadors SET
        free_used = free_used + ${freeUsed},
        bonus_used = bonus_used + ${bonusUsed},
        rate_used = rate_used + ${rateUsed}
      WHERE id = ${amb.id}
    `;
  } else {
    plan = items.map((item) => ({
      item,
      charge: Number(item.rental_price),
      waiver: true,
      kind: "full",
    }));
  }

  const cleaningFee = program.cleaning_fee;
  const subtotal = plan.reduce((s, p) => s + p.charge, 0);
  const waiverTotal = plan.filter((p) => p.waiver).length * cleaningFee;
  const grossTotal = subtotal + waiverTotal;

  // Apply any store credit the customer has, up to the order total.
  let creditApplied = 0;
  if (b.customer_id) {
    const cust = await sql`SELECT store_credit FROM customers WHERE id = ${b.customer_id}`;
    const bal = Number(cust[0]?.store_credit ?? 0);
    creditApplied = Math.min(bal, grossTotal);
  }
  const total = grossTotal - creditApplied;

  // One transaction row for the whole checkout.
  const txRows = await sql`
    INSERT INTO transactions (
      customer_id, piece_count, subtotal, waiver_total, total, store_credit_applied,
      start_date, due_date, payment_method, payment_status, payment_ref,
      agreement_accepted, agreement_name, agreement_accepted_at, receipt_email
    ) VALUES (
      ${b.customer_id ?? null}, ${items.length}, ${subtotal}, ${waiverTotal}, ${total},
      ${creditApplied}, ${b.start_date}, ${b.due_date}, ${b.payment_method || "card_reader"},
      'collected', ${b.payment_ref || null},
      true, ${b.agreement_name || null}, now(), ${b.receipt_email || null}
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

  // One active rental per piece, linked to the transaction, and flip each
  // piece to Rented Out (mirrors the rental "pickup" action).
  for (const p of plan) {
    const rentalRows = await sql`
      INSERT INTO rentals (
        item_id, customer_id, start_date, due_date, status,
        rental_price, damage_waiver, cleaning_fee, source, transaction_id
      ) VALUES (
        ${p.item.id}, ${b.customer_id ?? null}, ${b.start_date}, ${b.due_date},
        'active', ${p.charge}, ${p.waiver}, ${p.waiver ? cleaningFee : 0},
        'checkout', ${tx.id}
      )
      RETURNING id
    `;
    await sql`
      UPDATE items SET status = 'rented', rental_count = rental_count + 1, updated_at = now()
      WHERE id = ${p.item.id}
    `;
    // Free / bonus rentals collect no Cleaning & Care Fee, so BORROW absorbs
    // the cleaning cost — log it as an expense (the consignor is never charged).
    if (p.kind === "free" || p.kind === "bonus") {
      await sql`
        INSERT INTO cleaning_expenses (amount, reason, item_id, rental_id, consignor_id)
        VALUES (
          ${cleaningFee}, ${"free_ambassador_rental"}, ${p.item.id}, ${rentalRows[0].id},
          ${p.item.ownership === "consignment" ? p.item.consignor_id ?? null : null}
        )
      `;
    }
  }

  // Referral attribution: if a referral code was entered, link this rental +
  // customer to the ambassador whose code it is (tracking only, no auto-perk).
  let referredBy: string | null = null;
  const refCode = (b.referral_code || "").trim().toUpperCase();
  if (refCode) {
    const refAmb = await sql`
      SELECT id, name FROM ambassadors WHERE upper(referral_code) = ${refCode} LIMIT 1
    `;
    if (refAmb.length > 0) {
      await sql`
        INSERT INTO ambassador_referrals (ambassador_id, customer_id, transaction_id)
        VALUES (${refAmb[0].id}, ${b.customer_id ?? null}, ${tx.id})
      `;
      referredBy = refAmb[0].name;
    }
  }

  // Notify consignors whose pieces just rented (best-effort, free email).
  const consigned = await sql`
    SELECT COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.rental_price, c.name, c.email, c.portal_code
    FROM items i JOIN consignors c ON c.id = i.consignor_id
    WHERE i.id = ANY(${itemIds}) AND i.ownership = 'consignment' AND c.email IS NOT NULL
  `;
  for (const c of consigned) {
    const r = await sendConsignorRentedEmail({
      to: c.email,
      consignorName: c.name,
      brand: c.brand,
      earned: Math.round(Number(c.rental_price) * CONSIGNOR_SHARE * 100) / 100,
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
      waiver: p.waiver ? cleaningFee : 0,
    }));
    const result = await sendReceipt({
      to: recipient,
      customerName,
      lines,
      subtotal,
      waiverTotal,
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
      ambassador_applied: !!ambassador,
      blackout: !!amb && blackout,
      referred_by: referredBy,
      credit_applied: creditApplied,
      breakdown: plan.map((p) => ({
        barcode: p.item.barcode || p.item.id,
        kind: p.kind,
        charge: p.charge,
      })),
    },
    { status: 201 }
  );
}
