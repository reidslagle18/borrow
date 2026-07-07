import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { CONSIGNOR_SHARE } from "@/lib/types";

/**
 * Money rules:
 * - A rental counts (and its price + Cleaning & Care Fee are earned) once it's
 *   picked up — status active or completed — attributed to its start_date.
 * - Late fees are attributed to the returned_date.
 * - On consignment pieces BORROW keeps 40% of the rental price; the Cleaning &
 *   Care Fee and late fees are 100% BORROW.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const { searchParams } = new URL(request.url);
  const weekStart = searchParams.get("week_start");
  const monthStart = searchParams.get("month_start");
  const today = searchParams.get("today");
  if (!weekStart || !monthStart || !today) {
    return NextResponse.json(
      { error: "week_start, month_start and today are required" },
      { status: 400 }
    );
  }

  async function period(from: string | null) {
    const rentalAgg = from
      ? await sql`
          SELECT COUNT(*)::int AS rentals,
                 COALESCE(SUM(rental_price), 0) AS rental_revenue,
                 COALESCE(SUM(CASE WHEN cleaning_fee > 0 THEN cleaning_fee WHEN damage_waiver THEN 5 ELSE 0 END), 0) AS cleaning_fee_revenue,
                 COALESCE(SUM(sales_tax), 0) AS sales_tax
          FROM rentals
          WHERE status IN ('active','completed')
            AND start_date >= ${from} AND start_date <= ${today}
        `
      : await sql`
          SELECT COUNT(*)::int AS rentals,
                 COALESCE(SUM(rental_price), 0) AS rental_revenue,
                 COALESCE(SUM(CASE WHEN cleaning_fee > 0 THEN cleaning_fee WHEN damage_waiver THEN 5 ELSE 0 END), 0) AS cleaning_fee_revenue,
                 COALESCE(SUM(sales_tax), 0) AS sales_tax
          FROM rentals
          WHERE status IN ('active','completed')
        `;
    const feeAgg = from
      ? await sql`
          SELECT COALESCE(SUM(late_fee), 0) AS late_fees
          FROM rentals
          WHERE status = 'completed'
            AND returned_date >= ${from} AND returned_date <= ${today}
        `
      : await sql`
          SELECT COALESCE(SUM(late_fee), 0) AS late_fees
          FROM rentals WHERE status = 'completed'
        `;
    const cleaningAgg = from
      ? await sql`
          SELECT COALESCE(SUM(amount), 0) AS cleaning_cost
          FROM cleaning_expenses
          WHERE incurred_on >= ${from} AND incurred_on <= ${today}
        `
      : await sql`SELECT COALESCE(SUM(amount), 0) AS cleaning_cost FROM cleaning_expenses`;
    const r = rentalAgg[0];
    const rental_revenue = Number(r.rental_revenue);
    const cleaning_fee_revenue = Number(r.cleaning_fee_revenue);
    const late_fees = Number(feeAgg[0].late_fees);
    const cleaning_cost = Number(cleaningAgg[0].cleaning_cost);
    const sales_tax = Number(r.sales_tax);
    const total = rental_revenue + cleaning_fee_revenue + late_fees;
    return {
      rentals: r.rentals,
      rental_revenue,
      cleaning_fee_revenue,
      late_fees,
      cleaning_cost,
      sales_tax, // collected & held to remit — not Borrow revenue
      total,
      net: total - cleaning_cost,
    };
  }

  const [week, month, allTime] = await Promise.all([
    period(weekStart),
    period(monthStart),
    period(null),
  ]);

  const pieces = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.size, i.tier, i.ownership, i.status,
           i.photo_url, i.purchase_cost, i.rental_count,
           COALESCE(SUM(r.rental_price) FILTER (WHERE r.status IN ('active','completed')), 0) AS revenue
    FROM items i
    LEFT JOIN rentals r ON r.item_id = i.id
    GROUP BY i.id
    ORDER BY revenue DESC, i.rental_count DESC
  `;

  const enriched = pieces.map((p) => {
    const revenue = Number(p.revenue);
    const borrowRevenue =
      p.ownership === "consignment"
        ? Math.round(revenue * (1 - CONSIGNOR_SHARE) * 100) / 100
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
  });

  return NextResponse.json({ week, month, all_time: allTime, pieces: enriched });
}
