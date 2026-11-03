import { sql } from "@/lib/db";
import { getDropoffConfig, slotsForDate, availableSlots } from "@/lib/dropoff";
import { createDropoffEvent, deleteDropoffEvent, updateDropoffEvent } from "@/lib/gcal";

/**
 * Shared drop-off cancel/reschedule logic used by BOTH the studio route
 * (app/api/dropoff/[id]) and the customer self-service route
 * (app/api/public/dropoff-manage). Keeping it in one place guarantees a
 * customer cancelling their own appointment frees the slot and updates the
 * studio's Google Calendar exactly the way a staff cancellation does.
 */

type Appt = Record<string, unknown>;
export type ActionResult =
  | { ok: true; appt: Appt }
  | { ok: false; status: number; error: string };

/** Cancel an appointment — frees the slot (partial unique index) and removes
 *  the matching Google Calendar event (best-effort). */
export async function cancelAppointment(id: number | string): Promise<ActionResult> {
  const rows = await sql`
    UPDATE drop_off_appointments SET status = 'cancelled' WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) return { ok: false, status: 404, error: "Not found" };
  if (rows[0].gcal_event_id) {
    try {
      await deleteDropoffEvent(String(rows[0].gcal_event_id));
    } catch {
      /* non-fatal */
    }
  }
  return { ok: true, appt: rows[0] };
}

/** Move an appointment to a new slot — validates the slot, frees the old one,
 *  takes the new one, and moves the Google Calendar event (best-effort). */
export async function rescheduleAppointment(
  id: number | string,
  date: string,
  time: string,
  // Staff override: let the owner move an appointment to ANY date/time (even
  // outside the standard slots, on a closed day, or a time not normally offered)
  // for the exceptions they make. Customer self-service always passes false, so
  // they stay restricted to real open slots.
  override = false
): Promise<ActionResult> {
  if (!date || !time) {
    return { ok: false, status: 400, error: "Pick a new date and time." };
  }
  const cfg = await getDropoffConfig();
  if (!override) {
    if (!slotsForDate(cfg, date).includes(time)) {
      return { ok: false, status: 400, error: "That time isn't a valid slot." };
    }
    const open = await availableSlots(date);
    if (!open.includes(time)) {
      return { ok: false, status: 409, error: "That slot isn't available." };
    }
  }
  try {
    // A cancelled appointment can be rescheduled too (e.g. the studio cancelled
    // it while the owner was away): re-activate it and clear the reschedule flag.
    const prev = (
      await sql`SELECT status, gcal_event_id FROM drop_off_appointments WHERE id = ${id}`
    )[0];
    if (!prev) return { ok: false, status: 404, error: "Not found" };
    const rows = await sql`
      UPDATE drop_off_appointments
      SET slot_date = ${date}, slot_time = ${time}, status = 'booked', needs_reschedule = false
      WHERE id = ${id} AND status IN ('booked', 'cancelled') RETURNING *
    `;
    if (rows.length === 0) {
      return { ok: false, status: 400, error: "Not found or not active" };
    }
    const appt = rows[0];
    const gcalPayload = {
      name: String(appt.name),
      date,
      time,
      itemCount: Number(appt.item_count) || 1,
      durationMin: cfg.slot_minutes,
      phone: appt.phone ? String(appt.phone) : null,
      email: appt.email ? String(appt.email) : null,
    };
    // Re-activated (was cancelled) → its calendar event was deleted, so make a
    // fresh one. Otherwise just move the existing event.
    if (prev.status === "cancelled" || !appt.gcal_event_id) {
      try {
        const newId = await createDropoffEvent(gcalPayload);
        if (newId) {
          await sql`UPDATE drop_off_appointments SET gcal_event_id = ${newId} WHERE id = ${id}`;
          appt.gcal_event_id = newId;
        }
      } catch {
        /* non-fatal */
      }
    } else {
      try {
        await updateDropoffEvent(String(appt.gcal_event_id), gcalPayload);
      } catch {
        /* non-fatal */
      }
    }
    return { ok: true, appt };
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return {
        ok: false,
        status: 409,
        error: "There's already an appointment at that exact time — pick a slightly different time.",
      };
    }
    throw err;
  }
}
