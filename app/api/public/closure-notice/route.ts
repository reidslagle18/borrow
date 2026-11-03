import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { sendClosureReturnNotice } from "@/lib/email";
import { addDays, fmtWeekday } from "@/lib/dates";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY): handle a one-off store closure
 * for return purposes. For every active/reserved rental DUE on `closed_date`,
 * roll its return date forward to the next open day (using the store's closed
 * dates + closed weekdays) so the renter isn't charged a late fee for the days
 * we're shut, and email each customer the new return date.
 *
 * Add the date to the store's closed_dates FIRST (so the storefront blocks it and
 * this route's next-open-day math accounts for it), then call this.
 *
 * Body: {
 *   closed_date: "YYYY-MM-DD",
 *   dry_run?: boolean,
 *   reason?: string,              // e.g. "the home game" → "closed that day for the home game"
 *   email_rental_ids?: number[],  // email-only re-notify (no date change) for rentals
 *                                 // already rolled off closed_date — uses closed_date's labels
 * }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const closedDate = String(b.closed_date || "");
  const dryRun = b.dry_run === true;
  const reason =
    typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : undefined;
  const emailRentalIds: number[] = Array.isArray(b.email_rental_ids)
    ? b.email_rental_ids.map((x: unknown) => Number(x)).filter(Boolean)
    : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closedDate)) {
    return NextResponse.json(
      { error: "closed_date (YYYY-MM-DD) required" },
      { status: 400 }
    );
  }

  const program = await getProgram();
  const closedDates = new Set<string>(program.store_closed_dates || []);
  const closedWeekdays = new Set<number>(program.store_closed_weekdays || []);
  const isClosed = (iso: string) =>
    closedDates.has(iso) ||
    closedWeekdays.has(new Date(`${iso}T12:00:00Z`).getUTCDay());

  // Next open day strictly after the closed date.
  let nextOpen = addDays(closedDate, 1);
  let guard = 0;
  while (isClosed(nextOpen) && guard < 366) {
    nextOpen = addDays(nextOpen, 1);
    guard++;
  }

  // Email-only re-notify: for rentals already rolled off the closed date, just
  // (re)send the closure email (with the reason) — no date change.
  if (emailRentalIds.length > 0) {
    const er = await sql`
      SELECT r.id, c.name AS customer_name, c.email,
             COALESCE(NULLIF(i.name, ''), i.brand) AS brand
      FROM rentals r
      JOIN items i ON i.id = r.item_id
      LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.id = ANY(${emailRentalIds}::int[])
    `;
    const out: Array<Record<string, unknown>> = [];
    for (const r of er) {
      if (dryRun) {
        out.push({ rental_id: r.id, brand: r.brand, customer: r.customer_name, email: r.email });
        continue;
      }
      let emailed = false;
      if (r.email) {
        const res = await sendClosureReturnNotice({
          to: r.email as string,
          customerName: (r.customer_name as string) ?? "",
          pieces: [r.brand as string],
          closedLabel: fmtWeekday(closedDate),
          returnLabel: fmtWeekday(nextOpen),
          reason,
        });
        emailed = res.sent;
      }
      out.push({ rental_id: r.id, brand: r.brand, customer: r.customer_name, emailed });
    }
    return NextResponse.json({
      ok: true,
      mode: "email_only",
      dry_run: dryRun,
      closed_date: closedDate,
      next_open_day: nextOpen,
      affected: er.length,
      results: out,
    });
  }

  // Every rental (picked up or reserved) whose return lands on the closed day.
  const rows = await sql`
    SELECT r.id, r.item_id, to_char(r.start_date, 'YYYY-MM-DD') AS start_iso,
           c.name AS customer_name, c.email,
           COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    LEFT JOIN customers c ON c.id = r.customer_id
    WHERE r.status IN ('active', 'reserved')
      AND r.returned_date IS NULL
      AND r.due_date = ${closedDate}::date
    ORDER BY c.name
  `;

  const results: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    // Don't roll a return into another booking of the same piece.
    const conflict = await sql`
      SELECT 1 FROM rentals
      WHERE item_id = ${r.item_id}
        AND id != ${r.id}
        AND status IN ('reserved', 'active')
        AND start_date <= ${nextOpen}::date
        AND due_date >= ${r.start_iso}::date
      LIMIT 1
    `;
    if (conflict.length > 0) {
      results.push({ rental_id: r.id, brand: r.brand, skipped: "conflict" });
      continue;
    }
    if (dryRun) {
      results.push({
        rental_id: r.id,
        brand: r.brand,
        customer: r.customer_name,
        email: r.email,
        would_move_to: nextOpen,
      });
      continue;
    }
    await sql`
      UPDATE rentals SET due_date = ${nextOpen}::date, updated_at = now()
      WHERE id = ${r.id}
    `;
    let emailed = false;
    if (r.email) {
      const res = await sendClosureReturnNotice({
        to: r.email as string,
        customerName: (r.customer_name as string) ?? "",
        pieces: [r.brand as string],
        closedLabel: fmtWeekday(closedDate),
        returnLabel: fmtWeekday(nextOpen),
        reason,
      });
      emailed = res.sent;
    }
    results.push({
      rental_id: r.id,
      brand: r.brand,
      customer: r.customer_name,
      moved_to: nextOpen,
      emailed,
    });
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    closed_date: closedDate,
    next_open_day: nextOpen,
    affected: rows.length,
    results,
  });
}
