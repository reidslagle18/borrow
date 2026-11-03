import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getDropoffConfig, availableSlots, slotsForDate } from "@/lib/dropoff";
import { findOrCreateCustomer } from "@/lib/bookings";
import { currentConsignorRate } from "@/lib/rates";
import { sendDropoffConfirmation } from "@/lib/email";
import { createDropoffEvent } from "@/lib/gcal";

function authed(request: Request): boolean {
  const key = request.headers.get("x-api-key");
  return !!process.env.BOOKING_API_KEY && key === process.env.BOOKING_API_KEY;
}

/**
 * GET → drop-off config (for the calendar), plus available slots for ?date=.
 */
export async function GET(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const cfg = await getDropoffConfig();
  const date = new URL(request.url).searchParams.get("date");
  const slots = date ? await availableSlots(date) : [];
  return NextResponse.json(
    {
      config: {
        open_days: cfg.open_days,
        open_time: cfg.open_time,
        close_time: cfg.close_time,
        slot_minutes: cfg.slot_minutes,
        closed_dates: cfg.closed_dates,
      },
      slots,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** POST → book a slot (one per slot, no double-booking). */
export async function POST(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json();
  const name = (b.name || "").trim();
  const phone = (b.phone || "").trim();
  const email = (b.email || "").trim();
  const date = String(b.date || "");
  const time = String(b.time || "");
  const itemCount = Math.max(1, Math.floor(Number(b.item_count) || 0));

  if (!name || !date || !time) {
    return NextResponse.json({ error: "Name, date and time are required." }, { status: 400 });
  }
  if (!b.item_count || itemCount < 1) {
    return NextResponse.json({ error: "Tell us how many items you're bringing." }, { status: 400 });
  }
  if (!b.agreed) {
    return NextResponse.json({ error: "Please accept the drop-off guidelines." }, { status: 400 });
  }

  // The slot must be a real config slot AND currently available (not past,
  // closed, or already taken).
  const cfg = await getDropoffConfig();
  if (!slotsForDate(cfg, date).includes(time)) {
    return NextResponse.json({ error: "That time isn't a valid slot." }, { status: 400 });
  }
  const open = await availableSlots(date);
  if (!open.includes(time)) {
    return NextResponse.json(
      { error: "Sorry — that slot was just taken. Please pick another." },
      { status: 409 }
    );
  }

  // Link to an existing customer/consignor when we can match on email/phone.
  let customerId: number | null = null;
  if (email || phone) {
    try {
      customerId = await findOrCreateCustomer({ name, phone, email });
    } catch {
      /* non-fatal */
    }
  }
  const digits = phone.replace(/\D/g, "");
  const cons = await sql`
    SELECT id FROM consignors
    WHERE (${email}::text <> '' AND lower(email) = lower(${email}))
       OR (${digits}::text <> '' AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') = ${digits})
    LIMIT 1
  `;
  let consignorId = cons[0]?.id ?? null;

  // Pre-create a consignor account from the booking details so their name,
  // phone and email are already on file. When they actually come in, the owner
  // just clicks "Send setup email" — no retyping. We deliberately send NOTHING
  // now: people skip appointments, so the payout-setup email is always a manual
  // step. Non-fatal — the appointment still books if this hiccups.
  if (!consignorId && name && (email || phone)) {
    try {
      const created = await sql`
        INSERT INTO consignors (name, email, phone, notes, portal_code)
        VALUES (${name}, ${email || null}, ${phone || null},
                ${"Started from a drop-off booking — send setup email when they come in."},
                upper(substr(md5(random()::text), 1, 8)))
        RETURNING id
      `;
      consignorId = created[0]?.id ?? null;
    } catch (err) {
      console.log(`[dropoff] consignor pre-create skipped:`, (err as Error).message);
    }
  }

  // Secret token so the person who booked can manage their own appointment
  // (cancel/reschedule) from a link in their confirmation email.
  const manageToken = crypto.randomUUID();

  // The rate this booking locks in / is promised = the rate in effect today
  // (per the consignor rate schedule).
  const promisedRate = await currentConsignorRate();

  let appt;
  try {
    const rows = await sql`
      INSERT INTO drop_off_appointments
        (slot_date, slot_time, name, phone, email, item_count, customer_id, consignor_id, manage_token, promised_rate)
      VALUES (${date}, ${time}, ${name}, ${phone || null}, ${email || null},
              ${itemCount}, ${customerId}, ${consignorId}, ${manageToken}, ${promisedRate})
      RETURNING *
    `;
    appt = rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "Sorry — that slot was just taken. Please pick another." },
        { status: 409 }
      );
    }
    throw err;
  }

  if (email) {
    const r = await sendDropoffConfirmation({
      to: email,
      name,
      date,
      time,
      itemCount,
      manageToken,
      rate: promisedRate,
    });
    console.log(`[dropoff] confirmation to ${email}:`, JSON.stringify(r));
  }

  // Add it to the studio's Google Calendar (no-op unless the integration is
  // connected). Best-effort — never blocks or fails the booking.
  try {
    const eventId = await createDropoffEvent({
      name,
      date,
      time,
      itemCount,
      durationMin: cfg.slot_minutes,
      phone: phone || null,
      email: email || null,
    });
    if (eventId) {
      await sql`UPDATE drop_off_appointments SET gcal_event_id = ${eventId} WHERE id = ${appt.id}`;
    }
  } catch (err) {
    console.log(`[dropoff] calendar sync failed:`, (err as Error).message);
  }

  return NextResponse.json(
    { ok: true, date, time, item_count: itemCount, id: appt.id, manage_token: manageToken },
    { status: 201 }
  );
}
