import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { normalizeCode } from "@/lib/campaigns";

/**
 * Studio (session-gated): campaign give-back report for a date range.
 *   ?code=FIGHT&from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]
 * Counts tagged orders and sums their RENTAL PRICE only (excludes tax + extra-day
 * fees), excluding cancelled rentals and refunded transactions. Donation owed =
 * rental_total × the campaign's donation_rate. CSV lists each tagged order for
 * final accounting.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const u = new URL(request.url);
  const code = normalizeCode(u.searchParams.get("code"));
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  const format = u.searchParams.get("format");
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const camp = (await sql`SELECT code, organization, donation_rate FROM campaigns WHERE upper(code) = ${code} LIMIT 1`)[0];
  const rate = camp ? Number(camp.donation_rate) : 10;
  const organization = camp ? String(camp.organization) : "";

  // Tagged, non-cancelled rentals whose transaction (if any) isn't refunded,
  // within the payment-date range (by the rental's created date, Central).
  const rows = await sql`
    SELECT
      COALESCE('txn:' || r.transaction_id::text, r.stripe_session_id, 'r' || r.id::text) AS order_key,
      MIN(to_char((r.created_at AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD')) AS paid_date,
      MAX(COALESCE(c.name, '')) AS customer,
      (CASE WHEN bool_or(r.source = 'web') THEN 'online' ELSE 'in_store' END) AS source,
      COUNT(*)::int AS pieces,
      SUM(r.rental_price)::numeric(10,2) AS rental_total
    FROM rentals r
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN transactions t ON t.id = r.transaction_id
    WHERE upper(r.campaign_code) = ${code}
      AND r.status <> 'cancelled'
      AND (t.id IS NULL OR t.payment_status <> 'refunded')
      AND (${from}::date IS NULL OR (r.created_at AT TIME ZONE 'America/Chicago')::date >= ${from}::date)
      AND (${to}::date   IS NULL OR (r.created_at AT TIME ZONE 'America/Chicago')::date <= ${to}::date)
    GROUP BY COALESCE('txn:' || r.transaction_id::text, r.stripe_session_id, 'r' || r.id::text)
    ORDER BY paid_date
  `;

  const rentalTotal = Math.round(rows.reduce((s, r) => s + Number(r.rental_total), 0) * 100) / 100;
  const donation = Math.round(rentalTotal * (rate / 100) * 100) / 100;

  if (format === "csv") {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["Order", "Paid date", "Customer", "Source", "Pieces", "Rental total", `Donation (${rate}%)`].join(","),
      ...rows.map((r) =>
        [
          r.order_key,
          r.paid_date,
          r.customer,
          r.source,
          r.pieces,
          Number(r.rental_total).toFixed(2),
          (Number(r.rental_total) * (rate / 100)).toFixed(2),
        ].map(esc).join(",")
      ),
      ["TOTAL", "", "", "", rows.reduce((s, r) => s + Number(r.pieces), 0), rentalTotal.toFixed(2), donation.toFixed(2)].map(esc).join(","),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${code}_donation_${from || "all"}_${to || "all"}.csv"`,
      },
    });
  }

  return NextResponse.json({
    code,
    organization,
    donation_rate: rate,
    from: from || null,
    to: to || null,
    order_count: rows.length,
    rental_total: rentalTotal,
    donation_owed: donation,
    orders: rows,
  });
}
