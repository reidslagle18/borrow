import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { cancelAppointment, rescheduleAppointment } from "@/lib/dropoffActions";
import { sendDropoffRescheduleRequest } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

/** Cancel an appointment — frees the slot for others (partial unique index). */
export async function DELETE(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const res = await cancelAppointment(id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH — mark completed ({ action: "complete" }), or reschedule to a new slot
 * ({ date, time }), which frees the old slot and takes the new one.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();

  // Email the customer asking them to reschedule (their slot fell on a closed
  // day). Sends to the appointment's email; includes their self-service link.
  if (b.action === "email_reschedule") {
    const rows = await sql`
      SELECT name, email, to_char(slot_date, 'YYYY-MM-DD') AS date, slot_time, manage_token
      FROM drop_off_appointments WHERE id = ${id}
    `;
    const a = rows[0];
    if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!a.email) {
      return NextResponse.json({ error: "No email on file for this appointment." }, { status: 400 });
    }
    const r = await sendDropoffRescheduleRequest({
      to: String(a.email),
      name: String(a.name || ""),
      date: String(a.date),
      time: String(a.slot_time).slice(0, 5),
      manageToken: a.manage_token ? String(a.manage_token) : null,
    });
    if (!r.sent) {
      return NextResponse.json({ error: "Couldn't send the email (is email configured?)." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sent: true, to: a.email });
  }

  if (b.action === "complete") {
    const rows = await sql`
      UPDATE drop_off_appointments SET status = 'completed'
      WHERE id = ${id} AND status = 'booked' RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found or not active" }, { status: 400 });
    }
    return NextResponse.json(rows[0]);
  }

  // Staff reschedule: allow any date/time (exceptions), not just open slots.
  const res = await rescheduleAppointment(id, String(b.date || ""), String(b.time || ""), true);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.appt);
}
