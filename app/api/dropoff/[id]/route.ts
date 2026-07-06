import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getDropoffConfig, slotsForDate, availableSlots } from "@/lib/dropoff";

type Ctx = { params: Promise<{ id: string }> };

/** Cancel an appointment — frees the slot for others (partial unique index). */
export async function DELETE(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const rows = await sql`
    UPDATE drop_off_appointments SET status = 'cancelled' WHERE id = ${id} RETURNING id
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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

  const date = String(b.date || "");
  const time = String(b.time || "");
  if (!date || !time) {
    return NextResponse.json({ error: "date and time are required" }, { status: 400 });
  }
  const cfg = await getDropoffConfig();
  if (!slotsForDate(cfg, date).includes(time)) {
    return NextResponse.json({ error: "That time isn't a valid slot." }, { status: 400 });
  }
  const open = await availableSlots(date);
  if (!open.includes(time)) {
    return NextResponse.json({ error: "That slot isn't available." }, { status: 409 });
  }
  try {
    const rows = await sql`
      UPDATE drop_off_appointments SET slot_date = ${date}, slot_time = ${time}
      WHERE id = ${id} AND status = 'booked' RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found or not active" }, { status: 400 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "That slot was just taken." }, { status: 409 });
    }
    throw err;
  }
}
