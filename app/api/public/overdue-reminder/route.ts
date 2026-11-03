import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendOverdueReminder } from "@/lib/email";
import { fmtShort } from "@/lib/dates";

/**
 * Server-to-server: send an overdue-return reminder to a single customer for
 * THEIR OWN currently-overdue rentals. Requires the x-api-key header
 * (BOOKING_API_KEY). Scoped on purpose — it can only email the customer on file
 * about pieces that are genuinely past due and not yet returned, so it can't be
 * used to send arbitrary mail. No-ops (sent:false) when nothing is overdue.
 *
 * Body: { customer_id: number }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const customerId = Number(b.customer_id);
  if (!customerId) {
    return NextResponse.json({ error: "customer_id required" }, { status: 400 });
  }

  const rows = await sql`
    SELECT c.name AS customer_name, c.email,
           to_char(r.due_date, 'YYYY-MM-DD') AS due_iso,
           ((now() AT TIME ZONE 'America/Chicago')::date - r.due_date) AS days_overdue,
           COALESCE(NULLIF(i.name, ''), i.brand) AS brand
    FROM rentals r
    JOIN items i ON i.id = r.item_id
    JOIN customers c ON c.id = r.customer_id
    WHERE r.customer_id = ${customerId}
      AND r.status = 'active'
      AND r.returned_date IS NULL
      AND r.due_date < (now() AT TIME ZONE 'America/Chicago')::date
    ORDER BY r.due_date, brand
  `;

  if (rows.length === 0) {
    return NextResponse.json({ sent: false, reason: "nothing-overdue" });
  }
  const email = rows[0].email as string | null;
  if (!email) {
    return NextResponse.json({ sent: false, reason: "no-email" });
  }

  const res = await sendOverdueReminder({
    to: email,
    customerName: (rows[0].customer_name as string) ?? "",
    items: rows.map((r) => ({
      brand: r.brand as string,
      due: fmtShort(r.due_iso as string),
      daysOverdue: Number(r.days_overdue),
    })),
  });

  return NextResponse.json({
    sent: res.sent,
    error: res.error,
    to: email,
    pieces: rows.map((r) => r.brand),
  });
}
