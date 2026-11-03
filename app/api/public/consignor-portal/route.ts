import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { consignorShare } from "@/lib/types";
import { getProgram } from "@/lib/credits";
import { getDepositStatus } from "@/lib/connect";

/**
 * Consignor self-service portal feed for the customer site.
 * Auth is two-layer: the shop's server key (x-api-key) plus the
 * consignor's personal access code. Customer names are never included.
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSchema();
  const b = await request.json();
  const email = (b.email || "").trim().toLowerCase();
  const digits = (b.phone || "").replace(/\D/g, "");
  const code = (b.code || "").trim().toUpperCase();

  // Primary login: email + phone must both match the same consignor (mirrors
  // the customer account-login). Falls back to the access code if supplied
  // (used by the "your piece rented" email deep-link).
  let consignors;
  if (email && digits.length >= 7) {
    consignors = await sql`
      SELECT id, name, phone, email, stripe_account_id, payouts_enabled, consignor_rate FROM consignors
      WHERE lower(email) = ${email}
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits}
      LIMIT 1
    `;
    if (consignors.length === 0) {
      return NextResponse.json(
        { error: "No consignor matches that email and phone — check with BORROW" },
        { status: 404 }
      );
    }
  } else if (code && code.length >= 6) {
    consignors = await sql`
      SELECT id, name, phone, email, stripe_account_id, payouts_enabled, consignor_rate FROM consignors WHERE portal_code = ${code}
    `;
    if (consignors.length === 0) {
      return NextResponse.json(
        { error: "That code doesn't match — double-check with BORROW" },
        { status: 404 }
      );
    }
  } else {
    return NextResponse.json(
      { error: "Enter your email and phone number" },
      { status: 400 }
    );
  }
  const c = consignors[0];

  // Live direct-deposit truth (self-heals the cached flag, releases queued
  // payouts on activation, and tells the consignor exactly where things stand).
  const deposit = await getDepositStatus({
    id: Number(c.id),
    stripe_account_id: c.stripe_account_id ?? null,
    payouts_enabled: !!c.payouts_enabled,
  });

  const items = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.size, i.color, i.tier, i.rental_price,
           i.photo_url, i.status, i.rental_count,
      (SELECT COALESCE(SUM(r.rental_price), 0) FROM rentals r
        WHERE r.item_id = i.id AND r.status = 'completed') AS revenue,
      EXISTS(
        SELECT 1 FROM retrieval_requests rr
         WHERE rr.item_id = i.id AND rr.status = 'open'
      ) AS retrieval_requested,
      to_char(i.hold_start, 'YYYY-MM-DD') AS hold_start,
      to_char(i.hold_end, 'YYYY-MM-DD') AS hold_end,
      COALESCE(
        (SELECT json_agg(json_build_object('start_date', r.start_date, 'due_date', r.due_date)
                         ORDER BY r.start_date)
           FROM rentals r
          WHERE r.item_id = i.id AND r.status IN ('reserved','active')
            AND r.due_date >= (now() AT TIME ZONE 'America/Chicago')::date),
        '[]'
      ) AS booked
    FROM items i
    WHERE i.consignor_id = ${c.id}
    ORDER BY i.created_at DESC
  `;
  // Per-rental earnings history (each completed rental that paid this consignor).
  const earningRows = await sql`
    SELECT r.id, COALESCE(r.returned_date, r.due_date) AS date, r.rental_price,
           COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r JOIN items i ON i.id = r.item_id
    WHERE i.consignor_id = ${c.id} AND r.status = 'completed'
    ORDER BY COALESCE(r.returned_date, r.due_date) DESC, r.id DESC
    LIMIT 100
  `;
  const payouts = await sql`
    SELECT amount, method, paid_at FROM payouts
    WHERE consignor_id = ${c.id}
    ORDER BY paid_at DESC, id DESC
  `;
  // Pieces awaiting the consignor's approval (or flagged disputed).
  const pendingApprovals = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.description,
           i.photo_url, i.replacement_value, i.approval_status,
           i.disputed_value, i.dispute_note, i.dispute_outcome
    FROM items i
    WHERE i.consignor_id = ${c.id} AND i.approval_status IN ('pending', 'disputed')
    ORDER BY i.created_at DESC
  `;

  const share = consignorShare(c.consignor_rate);
  const rate = Math.round(share * 100);
  const retrievalFee = (await getProgram()).retrieval_cleaning_fee;
  const revenue = items.reduce((s, i) => s + Number(i.revenue), 0);
  const earned = Math.round(revenue * share * 100) / 100;
  const paid = payouts.reduce((s, p) => s + Number(p.amount), 0);

  return NextResponse.json({
    name: c.name,
    rate,
    retrieval_cleaning_fee: retrievalFee,
    items: items.map((i) => ({
      ...i,
      earned: Math.round(Number(i.revenue) * share * 100) / 100,
    })),
    payouts,
    earnings: earningRows.map((r) => ({
      id: r.id,
      date: r.date,
      brand: r.brand,
      amount: Math.round(Number(r.rental_price) * share * 100) / 100,
    })),
    pending_approvals: pendingApprovals,
    earned,
    paid,
    owed: Math.max(0, earned - paid),
    direct_deposit: deposit,
  });
}
