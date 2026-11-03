import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { cancelAppointment } from "@/lib/dropoffActions";
import { sendDropoffClosureReschedule } from "@/lib/email";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY). Owner is away on a day and must
 * move booked drop-offs. For each appointment id: grant the customer a store
 * credit (default $10), cancel the appointment (frees the slot + removes its
 * Google Calendar event), and email the person the urgent "DM us for a new time"
 * note. Idempotent-ish: skips appointments that aren't 'booked' so a re-run
 * won't double-credit.
 *
 * Body: { appointment_ids: number[], credit_amount?: number, dry_run?: boolean }
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const ids: number[] = Array.isArray(b.appointment_ids)
    ? b.appointment_ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n))
    : [];
  const creditAmount = b.credit_amount != null ? Math.round(Number(b.credit_amount) * 100) / 100 : 10;
  const dryRun = b.dry_run === true;
  if (ids.length === 0) {
    return NextResponse.json({ error: "appointment_ids required" }, { status: 400 });
  }

  const appts = await sql`
    SELECT id, name, email, customer_id, to_char(slot_date, 'YYYY-MM-DD') AS date, slot_time, status
    FROM drop_off_appointments WHERE id = ANY(${ids})
  `;

  const results: Array<Record<string, unknown>> = [];
  for (const a of appts) {
    const r: Record<string, unknown> = { id: a.id, name: a.name, date: a.date };
    if (a.status !== "booked") {
      r.skipped = `not booked (status ${a.status})`;
      results.push(r);
      continue;
    }
    if (dryRun) {
      r.would = { credit: !!a.customer_id && creditAmount, email: a.email || "(no email)" };
      results.push(r);
      continue;
    }

    // 1) Store credit (needs a linked customer).
    if (a.customer_id && creditAmount > 0) {
      await sql`
        INSERT INTO store_credit_entries (customer_id, amount, reason, note)
        VALUES (${a.customer_id}, ${creditAmount}, 'grant', ${"Apology — drop-off rescheduled (owner away " + a.date + ")"})
      `;
      await sql`UPDATE customers SET store_credit = store_credit + ${creditAmount} WHERE id = ${a.customer_id}`;
      r.credited = creditAmount;
    } else {
      r.credited = false;
      r.credit_note = a.customer_id ? "credit amount 0" : "no customer on file";
    }

    // 2) Cancel (frees the slot + deletes the Google Calendar event), and flag it
    // as still owing the customer a new time so it surfaces on /dropoff.
    const cancelRes = await cancelAppointment(a.id);
    r.cancelled = cancelRes.ok ? true : `failed: ${(cancelRes as { error?: string }).error ?? "error"}`;
    if (cancelRes.ok) {
      await sql`UPDATE drop_off_appointments SET needs_reschedule = true WHERE id = ${a.id}`;
    }

    // 3) Email the urgent reschedule note.
    if (a.email) {
      const sent = await sendDropoffClosureReschedule({
        to: String(a.email),
        name: String(a.name || ""),
        date: String(a.date),
        time: String(a.slot_time).slice(0, 5),
      });
      r.emailed = sent.sent ? String(a.email) : "send failed";
    } else {
      r.emailed = "no email on file";
    }
    results.push(r);
  }

  return NextResponse.json({ ok: true, dry_run: dryRun, count: results.length, results });
}
