import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { consignorShare } from "@/lib/types";
import { sumExpenses } from "@/lib/expenses";

/**
 * Borrow's Net Take for [from, to]: what Borrow keeps after paying consignors.
 *   renter collections (rental revenue + late/damage/replacement/missing-item
 *   charges − refunds − store credit granted)
 *   − consignor cost (their % share of rentals + full loss payouts − the $7
 *     cleaning fees deducted from their earnings, which stay with Borrow).
 * Rental revenue is realized at pickup (start_date); other charges at the date
 * they were charged; refunds at refunded_at.
 */
async function netTake(from: string, to: string) {
  const [rentalAgg, chargeAgg, refundAgg, creditAgg, shareAgg, lossAgg, cleanFeeAgg, quickAgg, reservedAgg, cashAgg] =
    await Promise.all([
      // Revenue = what you actually made: the e.closet amount on those rentals
      // (they're marked up), the in-store rental_price on everything else.
      sql`SELECT COALESCE(SUM(COALESCE(ecloset_amount, rental_price)),0) AS rental_revenue,
                 COALESCE(SUM(extra_days_fee),0) AS extra_days
          FROM rentals WHERE status IN ('active','completed')
            AND start_date >= ${from} AND start_date <= ${to}`,
      // Net of refunds: (amount − refunded_amount) so a fully- OR partially-
      // refunded late/other fee counts only for what was actually kept.
      sql`SELECT kind, COALESCE(SUM(amount - refunded_amount),0) AS total FROM customer_charges
          WHERE status='succeeded'
            AND created_at::date >= ${from} AND created_at::date <= ${to}
          GROUP BY kind`,
      sql`SELECT COALESCE(SUM(refund_amount),0) AS total FROM transactions
          WHERE refunded_at IS NOT NULL AND refunded_at::date >= ${from} AND refunded_at::date <= ${to}`,
      sql`SELECT COALESCE(SUM(amount),0) AS total FROM store_credit_entries
          WHERE amount > 0 AND created_at::date >= ${from} AND created_at::date <= ${to}`,
      // Consignor cost = rate × the IN-STORE price (same on e.closet as in store).
      sql`SELECT COALESCE(SUM(r.rental_price * (COALESCE(c.consignor_rate,60)/100.0)),0) AS total
          FROM rentals r JOIN items i ON i.id=r.item_id
          LEFT JOIN consignors c ON c.id=i.consignor_id
          WHERE r.status IN ('active','completed') AND i.ownership='consignment'
            AND r.damage_kind IS DISTINCT FROM 'loss'
            AND r.start_date >= ${from} AND r.start_date <= ${to}`,
      sql`SELECT COALESCE(SUM(amount),0) AS total FROM payouts
          WHERE kind='loss' AND created_at::date >= ${from} AND created_at::date <= ${to}`,
      sql`SELECT COALESCE(SUM(amount),0) AS total FROM consignor_charges
          WHERE charged_on >= ${from} AND charged_on <= ${to}`,
      sql`SELECT COALESCE(SUM(amount),0) AS total FROM quick_charges
          WHERE status='succeeded'
            AND created_at::date >= ${from} AND created_at::date <= ${to}`,
      // Reserved (prepaid) rentals PAID in this window but not yet picked up.
      // Surfaced as an additive line (not folded into realized Net Take):
      // revenue collected + the consignor cut that will be owed on pickup, so
      // the net reserved contribution = revenue − consignor.
      sql`SELECT
            COALESCE(SUM(COALESCE(r.ecloset_amount, r.rental_price) + COALESCE(r.extra_days_fee,0)),0) AS revenue,
            COALESCE(SUM(CASE WHEN i.ownership='consignment'
              THEN r.rental_price * (COALESCE(c.consignor_rate,60)/100.0) ELSE 0 END),0) AS consignor
          FROM rentals r JOIN items i ON i.id=r.item_id
          LEFT JOIN consignors c ON c.id=i.consignor_id
          WHERE r.status='reserved' AND r.paid=true
            AND r.created_at::date >= ${from} AND r.created_at::date <= ${to}`,
      // CASH basis — every rental PAID in this window (reserved, active or
      // completed), by payment date, plus the consignor cut owed on them. Powers
      // the "everything paid" + "what Borrow made" headline. Rentals only here;
      // fees/quick/refunds/credit (already created_at-based) are added on in JS.
      sql`SELECT
            COALESCE(SUM(COALESCE(r.ecloset_amount, r.rental_price) + COALESCE(r.extra_days_fee,0)),0) AS revenue,
            COALESCE(SUM(CASE WHEN i.ownership='consignment' AND r.damage_kind IS DISTINCT FROM 'loss'
              THEN r.rental_price * (COALESCE(c.consignor_rate,60)/100.0) ELSE 0 END),0) AS consignor
          FROM rentals r JOIN items i ON i.id=r.item_id
          LEFT JOIN consignors c ON c.id=i.consignor_id
          WHERE r.paid=true AND r.status <> 'cancelled'
            AND r.created_at::date >= ${from} AND r.created_at::date <= ${to}`,
    ]);
  const byKind: Record<string, number> = {};
  for (const r of chargeAgg) byKind[String(r.kind)] = Number(r.total);
  const rental_revenue = Number(rentalAgg[0].rental_revenue) + Number(rentalAgg[0].extra_days);
  const late_fees = byKind.late_fee || 0;
  const damage_replacement = (byKind.repair || 0) + (byKind.replacement || 0);
  const missing_item_fees = (byKind.hanger || 0) + (byKind.garment_bag || 0);
  const refunds = Number(refundAgg[0].total);
  const store_credit = Number(creditAgg[0].total);
  const consignor_share = Math.round(Number(shareAgg[0].total) * 100) / 100;
  const loss_payouts = Number(lossAgg[0].total);
  const cleaning_fees_kept = Number(cleanFeeAgg[0].total);
  const quick_charges = Math.round(Number(quickAgg[0].total) * 100) / 100;
  const consignor_payouts = Math.round((consignor_share + loss_payouts - cleaning_fees_kept) * 100) / 100;
  const renter_collected =
    rental_revenue + late_fees + damage_replacement + missing_item_fees + quick_charges - refunds - store_credit;
  const net_take = Math.round((renter_collected - consignor_payouts) * 100) / 100;
  // Net reserved contribution (prepaid revenue − consignor cut owed on pickup),
  // shown as an additive line. net_take_incl_reserved = realized + reserved.
  const reserved_prepaid =
    Math.round(
      (Number(reservedAgg[0].revenue) - Number(reservedAgg[0].consignor)) * 100
    ) / 100;
  const net_take_incl_reserved = Math.round((net_take + reserved_prepaid) * 100) / 100;
  // CASH basis (by payment date): everything paid in the window + what Borrow
  // keeps of it. Rentals from cashAgg; the fee/quick/refund/credit aggregates
  // above are already created_at-based, so they apply directly here too.
  const cash_rental = Number(cashAgg[0].revenue);
  const cash_consignor =
    Math.round((Number(cashAgg[0].consignor) + loss_payouts - cleaning_fees_kept) * 100) / 100;
  const everything_paid =
    Math.round(
      (cash_rental + late_fees + damage_replacement + missing_item_fees + quick_charges - refunds - store_credit) * 100
    ) / 100;
  const borrow_made = Math.round((everything_paid - cash_consignor) * 100) / 100;
  return {
    rental_revenue: Math.round(rental_revenue * 100) / 100,
    late_fees,
    damage_replacement,
    missing_item_fees,
    quick_charges,
    refunds,
    store_credit,
    consignor_payouts,
    net_take,
    reserved_prepaid,
    net_take_incl_reserved,
    everything_paid,
    borrow_made,
  };
}

function monthStartOf(iso: string): string {
  return iso.slice(0, 8) + "01";
}

/**
 * Money rules:
 * - A rental counts (and its price + Cleaning & Care Fee are earned) once it's
 *   picked up — status active or completed — attributed to its start_date.
 * - Late fees (and other renter charges) are attributed to the day they were
 *   charged to the card, net of any refund, so fees on pieces still out count.
 * - On consignment pieces BORROW keeps the rental price minus the consignor's
 *   own locked rate (100% − their %); the Cleaning & Care Fee and late fees are
 *   100% BORROW.
 */
export async function GET(request: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get("week_start");
  const monthStart = searchParams.get("month_start");
  const today = searchParams.get("today");
  const day = searchParams.get("day"); // optional single-day view (YYYY-MM-DD)
  if (!weekStart || !monthStart || !today) {
    return NextResponse.json(
      { error: "week_start, month_start and today are required" },
      { status: 400 }
    );
  }

  // Revenue for a window [from, to]. from=null => all-time (no bounds); to
  // defaults to `today`. A single day is period(d, d).
  async function period(from: string | null, to?: string | null) {
    const upper = to ?? today;
    const rentalAgg = from
      ? await sql`
          SELECT COUNT(*)::int AS rentals,
                 COALESCE(SUM(COALESCE(ecloset_amount, rental_price)), 0) AS rental_revenue,
                 COALESCE(SUM(CASE WHEN cleaning_fee > 0 THEN cleaning_fee WHEN damage_waiver THEN 5 ELSE 0 END), 0) AS cleaning_fee_revenue,
                 COALESCE(SUM(extra_days_fee), 0) AS extra_days_revenue,
                 COALESCE(SUM(sales_tax), 0) AS sales_tax
          FROM rentals
          WHERE status IN ('active','completed')
            AND start_date >= ${from} AND start_date <= ${upper}
        `
      : await sql`
          SELECT COUNT(*)::int AS rentals,
                 COALESCE(SUM(COALESCE(ecloset_amount, rental_price)), 0) AS rental_revenue,
                 COALESCE(SUM(CASE WHEN cleaning_fee > 0 THEN cleaning_fee WHEN damage_waiver THEN 5 ELSE 0 END), 0) AS cleaning_fee_revenue,
                 COALESCE(SUM(extra_days_fee), 0) AS extra_days_revenue,
                 COALESCE(SUM(sales_tax), 0) AS sales_tax
          FROM rentals
          WHERE status IN ('active','completed')
        `;
    // Late-fee income = what was actually charged to renters' cards (net of any
    // refunds), attributed to the day it was charged. This is the daily job's
    // real collections — so fees on pieces that are STILL OUT (overdue, not yet
    // returned) count too, not just fees tallied at check-in. Supersedes the old
    // rentals.late_fee-at-returned_date basis (which read $0 until a piece came
    // back, hiding late-fee income the studio had already collected).
    const feeAgg = from
      ? await sql`
          SELECT COALESCE(SUM(amount - refunded_amount), 0) AS late_fees
          FROM customer_charges
          WHERE kind = 'late_fee' AND status = 'succeeded'
            AND created_at::date >= ${from} AND created_at::date <= ${upper}
        `
      : await sql`
          SELECT COALESCE(SUM(amount - refunded_amount), 0) AS late_fees
          FROM customer_charges WHERE kind = 'late_fee' AND status = 'succeeded'
        `;
    const cleaningAgg = from
      ? await sql`
          SELECT COALESCE(SUM(amount), 0) AS cleaning_cost
          FROM cleaning_expenses
          WHERE incurred_on >= ${from} AND incurred_on <= ${upper}
        `
      : await sql`SELECT COALESCE(SUM(amount), 0) AS cleaning_cost FROM cleaning_expenses`;
    // Reserved (prepaid) revenue PAID in this window but not yet picked up —
    // an additive line on the card (same revenue basis as the card). Attributed
    // by payment date (created_at) so it reflects money collected this period.
    const reservedAgg = from
      ? await sql`
          SELECT COALESCE(SUM(COALESCE(ecloset_amount, rental_price) + COALESCE(extra_days_fee,0)), 0) AS reserved_revenue
          FROM rentals
          WHERE status = 'reserved' AND paid = true
            AND created_at::date >= ${from} AND created_at::date <= ${upper}
        `
      : await sql`
          SELECT COALESCE(SUM(COALESCE(ecloset_amount, rental_price) + COALESCE(extra_days_fee,0)), 0) AS reserved_revenue
          FROM rentals WHERE status = 'reserved' AND paid = true
        `;
    const r = rentalAgg[0];
    const rental_revenue = Number(r.rental_revenue);
    const cleaning_fee_revenue = Number(r.cleaning_fee_revenue);
    const extra_days_revenue = Number(r.extra_days_revenue);
    const late_fees = Number(feeAgg[0].late_fees);
    const cleaning_cost = Number(cleaningAgg[0].cleaning_cost);
    const sales_tax = Number(r.sales_tax);
    const reserved_revenue = Number(reservedAgg[0].reserved_revenue);
    const total = rental_revenue + cleaning_fee_revenue + extra_days_revenue + late_fees;
    return {
      rentals: r.rentals,
      rental_revenue,
      cleaning_fee_revenue,
      extra_days_revenue,
      late_fees,
      cleaning_cost,
      sales_tax, // collected & held to remit — not Borrow revenue
      reserved_revenue, // prepaid reservations collected this window (additive)
      total,
      total_incl_reserved: Math.round((total + reserved_revenue) * 100) / 100,
      net: total - cleaning_cost,
    };
  }

  const [week, month, allTime] = await Promise.all([
    period(weekStart, today),
    period(monthStart, today),
    period(null, null),
  ]);

  // Single-day revenue: defaults to today, or any day the owner picks. Rentals
  // count on their pickup (start_date); late fees on the returned_date.
  const dayISO = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
  const dayRevenue = { date: dayISO, ...(await period(dayISO, dayISO)) };

  // Daily drill-down by PAYMENT date: every paid order created on `dayISO`,
  // split by its current status (still Reserved vs already Rented Out), plus any
  // fees charged and refunds/credits issued that day. Each order counts once —
  // on its payment day — so a reservation paid today is NOT re-counted when it's
  // picked up later (created_at never moves). Revenue components mirror netTake.
  const [dayRentalAgg, dayFeeAgg, dayRefundAgg, dayCreditAgg] = await Promise.all([
    sql`
      SELECT
        COALESCE(SUM(COALESCE(ecloset_amount, rental_price)) FILTER (WHERE status = 'reserved'), 0) AS reserved_rental,
        COALESCE(SUM(COALESCE(ecloset_amount, rental_price)) FILTER (WHERE status IN ('active','completed')), 0) AS rented_rental,
        COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved_count,
        COUNT(*) FILTER (WHERE status IN ('active','completed'))::int AS rented_count
      FROM rentals
      WHERE paid = true AND status <> 'cancelled'
        AND (created_at AT TIME ZONE 'America/Chicago')::date = ${dayISO}
    `,
    sql`
      SELECT kind, COALESCE(SUM(amount - refunded_amount), 0) AS total FROM customer_charges
      WHERE status = 'succeeded'
        AND (created_at AT TIME ZONE 'America/Chicago')::date = ${dayISO}
      GROUP BY kind
    `,
    sql`
      SELECT COALESCE(SUM(refund_amount), 0) AS total FROM transactions
      WHERE refunded_at IS NOT NULL
        AND (refunded_at AT TIME ZONE 'America/Chicago')::date = ${dayISO}
    `,
    sql`
      SELECT COALESCE(SUM(amount), 0) AS total FROM store_credit_entries
      WHERE amount > 0 AND (created_at AT TIME ZONE 'America/Chicago')::date = ${dayISO}
    `,
  ]);
  const dKind: Record<string, number> = {};
  for (const r of dayFeeAgg) dKind[String(r.kind)] = Number(r.total);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const dResRental = Number(dayRentalAgg[0].reserved_rental);
  const dRentRental = Number(dayRentalAgg[0].rented_rental);
  const dLate = dKind.late_fee || 0;
  const dDamage = (dKind.repair || 0) + (dKind.replacement || 0);
  const dMissing = (dKind.hanger || 0) + (dKind.garment_bag || 0);
  const dFees = dLate + dDamage + dMissing;
  const dRefunds = Number(dayRefundAgg[0].total);
  const dCredit = Number(dayCreditAgg[0].total);
  const dayPaid = {
    date: dayISO,
    reserved_rental: r2(dResRental),
    rented_rental: r2(dRentRental),
    reserved_count: Number(dayRentalAgg[0].reserved_count),
    rented_count: Number(dayRentalAgg[0].rented_count),
    late_fees: dLate,
    damage_replacement: dDamage,
    missing_item_fees: dMissing,
    fees_total: r2(dFees),
    refunds: dRefunds,
    store_credit: dCredit,
    // Totals per status filter. Fees + refunds/credits attach to the rented-out
    // side (fees only exist once a piece is out; a cancelled reservation's refund
    // isn't in reserved_rental since it's no longer 'reserved').
    reserved_total: r2(dResRental),
    rented_total: r2(dRentRental + dFees - dRefunds - dCredit),
    both_total: r2(dResRental + dRentRental + dFees - dRefunds - dCredit),
  };

  // Net Take + Estimated Profit for a selectable range (default: this month).
  const validDay = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const rangeFrom = validDay(searchParams.get("range_from")) ?? monthStartOf(today);
  const rangeTo = validDay(searchParams.get("range_to")) ?? today;
  const [nt, exp] = await Promise.all([netTake(rangeFrom, rangeTo), sumExpenses(rangeFrom, rangeTo)]);
  const summary = {
    from: rangeFrom,
    to: rangeTo,
    ...nt,
    expenses_total: exp.total,
    expenses_by_category: exp.by_category,
    estimated_profit: Math.round((nt.net_take - exp.total) * 100) / 100,
  };

  // Reserved & prepaid: money already collected for reservations that haven't
  // been picked up yet (online + in-store future bookings). Not counted as
  // realized revenue above — it flows into the numbers when each piece is
  // picked up, and can still refund if a reservation is cancelled. Shown as a
  // current snapshot (not period-scoped).
  const reservedAgg = await sql`
    SELECT COUNT(*)::int AS count,
           COALESCE(SUM(COALESCE(ecloset_amount, rental_price)), 0) AS amount,
           COALESCE(SUM(COALESCE(ecloset_amount, rental_price)) FILTER (WHERE source = 'web'), 0) AS online_amount,
           COALESCE(SUM(COALESCE(ecloset_amount, rental_price)) FILTER (WHERE source <> 'web'), 0) AS instore_amount
    FROM rentals
    WHERE status = 'reserved' AND paid = true
  `;
  const rp = reservedAgg[0];
  const reserved_prepaid = {
    count: Number(rp.count),
    amount: Number(rp.amount),
    online_amount: Number(rp.online_amount),
    instore_amount: Number(rp.instore_amount),
  };

  const pieces = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.size, i.tier, i.ownership, i.status,
           i.photo_url, i.purchase_cost, i.rental_count,
           COALESCE(c.consignor_rate, 60) AS consignor_rate,
           COALESCE(SUM(COALESCE(r.ecloset_amount, r.rental_price)) FILTER (WHERE r.status IN ('active','completed')), 0) AS revenue
    FROM items i
    LEFT JOIN rentals r ON r.item_id = i.id
    LEFT JOIN consignors c ON c.id = i.consignor_id
    GROUP BY i.id, c.consignor_rate
    ORDER BY revenue DESC, i.rental_count DESC
  `;

  const enriched = pieces
    .map((p) => {
      const revenue = Number(p.revenue);
      // Borrow keeps 100% minus this piece's consignor's locked rate.
      const borrowRevenue =
        p.ownership === "consignment"
          ? Math.round(revenue * (1 - consignorShare(p.consignor_rate)) * 100) / 100
          : revenue;
      const cost = p.purchase_cost != null ? Number(p.purchase_cost) : null;
      return {
        ...p,
        revenue,
        borrow_revenue: borrowRevenue,
        paid_off: p.ownership === "owned" && cost != null && cost > 0
          ? borrowRevenue >= cost
          : null,
      };
    })
    // Rank by what Borrow actually KEPT (borrow_revenue), so consignment pieces
    // are judged on Borrow's share, not their gross. Ties fall back to rentals.
    .sort(
      (a, b) =>
        b.borrow_revenue - a.borrow_revenue ||
        Number(b.rental_count) - Number(a.rental_count)
    );

  return NextResponse.json({ week, month, all_time: allTime, day_revenue: dayRevenue, day_paid: dayPaid, summary, reserved_prepaid, pieces: enriched });
}
