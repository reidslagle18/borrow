import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { cancelAppointment, rescheduleAppointment } from "@/lib/dropoffActions";

/**
 * Self-service drop-off management for customers. Identity is the secret
 * `manage_token` from their confirmation email — no login. The shop proxies
 * here with the BOOKING_API_KEY. Cancel/reschedule reuse the same logic the
 * studio uses, so the slot is freed and the Google Calendar stays in sync.
 */

function authed(request: Request): boolean {
  const key = request.headers.get("x-api-key");
  return !!process.env.BOOKING_API_KEY && key === process.env.BOOKING_API_KEY;
}

function ymd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

type Appt = { id: number; slot_date: unknown; slot_time: unknown; name: unknown; item_count: unknown; status: unknown };

function view(appt: Appt) {
  return {
    date: ymd(appt.slot_date),
    time: String(appt.slot_time),
    item_count: Number(appt.item_count) || 1,
    name: String(appt.name),
    status: String(appt.status),
  };
}

async function findByToken(token: string): Promise<Appt | null> {
  if (!token) return null;
  const rows = await sql`
    SELECT id, slot_date, slot_time, name, item_count, status
    FROM drop_off_appointments WHERE manage_token = ${token} LIMIT 1
  `;
  return (rows[0] as Appt) || null;
}

export async function POST(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json();
  const token = String(b.token || "");
  const appt = await findByToken(token);
  if (!appt) {
    return NextResponse.json(
      { error: "We couldn't find that appointment. The link may be out of date." },
      { status: 404 }
    );
  }

  const action = String(b.action || "view");
  if (action === "view") {
    return NextResponse.json(view(appt));
  }

  // Anything past 'booked' can't be changed by the customer.
  if (String(appt.status) !== "booked") {
    return NextResponse.json(
      {
        error:
          String(appt.status) === "cancelled"
            ? "This appointment was already cancelled."
            : "This appointment can no longer be changed. Please reach out if you need help.",
        status: String(appt.status),
      },
      { status: 409 }
    );
  }

  if (action === "cancel") {
    const res = await cancelAppointment(appt.id);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  if (action === "reschedule") {
    const res = await rescheduleAppointment(appt.id, String(b.date || ""), String(b.time || ""));
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json({ ok: true, ...view(res.appt as Appt) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
