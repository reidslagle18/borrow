import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { sendRetrievalRequest } from "@/lib/email";
import { todayISO } from "@/lib/dates";

/**
 * A consignor places a SELF-HOLD on one of their pieces from their hub: "I'd
 * like this back for these dates." They pick a real date range (start + end).
 * It's not a rental — no charge, no late fee. The piece is blocked from the
 * start date and stays on hold until the owner manually marks it returned
 * (the requested end date is a target for follow-up, not an auto-release).
 *
 * Allowed whenever no booking overlaps the requested range. Two-layer auth:
 * the shop's server key plus the consignor's own email+phone (or portal code).
 * The studio owner is notified (email + the in-studio "Needs attention" feed).
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const b = await request.json().catch(() => ({}));

  const email = (b.email || "").trim().toLowerCase();
  const digits = (b.phone || "").replace(/\D/g, "");
  const code = (b.code || "").trim().toUpperCase();
  const itemId = String(b.item_id || "");
  const note = (b.note || "").toString().trim().slice(0, 500) || null;
  if (!itemId) {
    return NextResponse.json({ error: "item_id is required" }, { status: 400 });
  }

  // A self-hold requires BOTH a start and an end date, each valid, in order,
  // and no earlier than today. The hold covers exactly that range.
  const holdStart = (b.hold_start || "").toString().trim();
  const holdEnd = (b.hold_end || "").toString().trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(holdStart) || !dateRe.test(holdEnd)) {
    return NextResponse.json(
      { error: "Please choose both a start date and an end date." },
      { status: 400 }
    );
  }
  const today = todayISO();
  if (holdStart < today) {
    return NextResponse.json(
      { error: "The start date can't be in the past." },
      { status: 400 }
    );
  }
  if (holdEnd < holdStart) {
    return NextResponse.json(
      { error: "The end date has to be on or after the start date." },
      { status: 400 }
    );
  }

  // They must acknowledge the return-clean / cleaning-fee notice.
  if (b.cleaning_ack !== true) {
    return NextResponse.json(
      { error: "Please acknowledge the return-clean notice first." },
      { status: 400 }
    );
  }

  // Resolve the consignor the same way the portal login does.
  let consignors;
  if (email && digits.length >= 7) {
    consignors = await sql`
      SELECT id, name FROM consignors
      WHERE lower(email) = ${email}
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits}
      LIMIT 1
    `;
  } else if (code && code.length >= 6) {
    consignors = await sql`SELECT id, name FROM consignors WHERE portal_code = ${code}`;
  } else {
    return NextResponse.json({ error: "Sign in to request a piece back" }, { status: 401 });
  }
  const c = consignors[0];
  if (!c) return NextResponse.json({ error: "Consignor not found" }, { status: 404 });

  // The piece must belong to this consignor and be eligible: not already gone /
  // on hold, and free across the whole requested range (no booking overlaps it).
  const owned = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.status,
      (SELECT COUNT(*) FROM rentals r
        WHERE r.item_id = i.id AND r.status IN ('reserved','active')
          AND r.start_date <= ${holdEnd}::date
          AND r.due_date >= ${holdStart}::date) AS overlap
    FROM items i
    WHERE i.id = ${itemId} AND i.consignor_id = ${c.id}
  `;
  if (owned.length === 0) {
    return NextResponse.json({ error: "That piece isn't in your closet" }, { status: 404 });
  }
  const piece = owned[0];
  const status = String(piece.status);

  if (status === "retired" || status === "with_consignor") {
    return NextResponse.json(
      { error: "This piece is already back with you." },
      { status: 409 }
    );
  }
  if (status === "consignor_hold") {
    return NextResponse.json(
      { error: "This piece is already on hold for you." },
      { status: 409 }
    );
  }
  if (Number(piece.overlap) > 0) {
    return NextResponse.json(
      {
        error:
          "This piece is booked during those dates. Please pick a range after its bookings end.",
      },
      { status: 409 }
    );
  }

  // Record the hold (idempotent — a second tap while one is open is a no-op).
  const rows = await sql`
    INSERT INTO retrieval_requests
      (consignor_id, item_id, note, requested_date, hold_start, hold_end, cleaning_ack)
    VALUES (${c.id}, ${itemId}, ${note}, ${holdStart}, ${holdStart}, ${holdEnd}, true)
    ON CONFLICT (item_id) WHERE status = 'open' DO NOTHING
    RETURNING id
  `;

  // Only act on a newly-created hold, so a stray re-tap can't move an existing
  // one. Placing a hold also cancels any active underperformance / pickup /
  // storage clock and pulls the piece out of storage.
  if (rows.length > 0) {
    // Set the hold window. If the start date is today or past, the piece is
    // theirs now → flip straight to 'consignor_hold' (off the shop, unbookable)
    // as long as it's physically on hand. A future-dated hold just records the
    // window; the daily cron flips it when the start date arrives. A piece still
    // out on a rental keeps that status and flips on its normal return.
    await sql`
      UPDATE items SET
        hold_start = ${holdStart}::date,
        hold_end = ${holdEnd}::date,
        retrieval_hold_date = ${holdStart}::date,
        status = CASE
          WHEN ${holdStart}::date <= (now() AT TIME ZONE 'America/Chicago')::date AND status IN ('available','reserved','cleaning','in_storage')
            THEN 'consignor_hold'
          WHEN status = 'in_storage' THEN 'available'
          ELSE status
        END,
        pickup_notice_sent_at = NULL,
        pickup_reminder_sent_at = NULL,
        storage_started_at = NULL,
        storage_decided_at = NULL,
        underperf_dismissed_at = NULL,
        updated_at = now()
      WHERE id = ${itemId}
    `;

    // Only email the owner NOW if the hold is already actionable — i.e. it
    // starts within the reminder lead window. A far-future hold is recorded and
    // shows on the Consignor Holds view, but doesn't ping the owner at request
    // time; it surfaces in Needs Attention within `hold_notice_lead_days` of its
    // start (eligibility already prevents a booking conflict at request time).
    let leadDays = 2;
    try {
      leadDays = Math.max(0, Number((await getProgram()).hold_notice_lead_days ?? 2));
    } catch {
      /* default lead */
    }
    const cutoff = new Date(today + "T12:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() + leadDays);
    const actionableNow = holdStart <= cutoff.toISOString().slice(0, 10);
    if (actionableNow) {
      try {
        await sendRetrievalRequest({
          consignorName: String(c.name || "A consignor"),
          itemBrand: String(piece.brand),
          consignorId: Number(c.id),
          note,
        });
      } catch {
        /* non-fatal — it still shows on the Consignor Holds view */
      }
    }
  }

  return NextResponse.json({ ok: true, item_id: itemId, hold_start: holdStart, hold_end: holdEnd });
}
