import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendDisputeAlert } from "@/lib/email";

/**
 * A consignor approves or disputes the agreed replacement value of one of their
 * pieces, from their self-service hub. Two-layer auth: the shop's server key
 * plus the consignor's own email+phone (or access code). A dispute can't change
 * the value — it flags the piece for in-person review.
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
  const action = String(b.action || "");
  if (!itemId || (action !== "approve" && action !== "dispute")) {
    return NextResponse.json({ error: "item_id and a valid action are required" }, { status: 400 });
  }

  // Resolve the consignor the same way the portal login does.
  let consignors;
  if (email && digits.length >= 7) {
    consignors = await sql`
      SELECT id FROM consignors
      WHERE lower(email) = ${email}
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits}
      LIMIT 1
    `;
  } else if (code && code.length >= 6) {
    consignors = await sql`SELECT id FROM consignors WHERE portal_code = ${code}`;
  } else {
    return NextResponse.json({ error: "Sign in to approve items" }, { status: 401 });
  }
  const c = consignors[0];
  if (!c) return NextResponse.json({ error: "Consignor not found" }, { status: 404 });

  // The piece must belong to this consignor and be awaiting their review.
  const owned = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand, i.replacement_value
    FROM items i
    WHERE i.id = ${itemId} AND i.consignor_id = ${c.id}
      AND i.approval_status = 'pending'
  `;
  if (owned.length === 0) {
    return NextResponse.json({ error: "That piece isn't awaiting your approval" }, { status: 404 });
  }
  const piece = owned[0];

  if (action === "approve") {
    await sql`
      UPDATE items SET
        approval_status = 'approved', approved_at = now(),
        disputed_at = NULL, disputed_value = NULL, dispute_note = NULL, dispute_outcome = NULL
      WHERE id = ${itemId}
    `;
    return NextResponse.json({ ok: true, item_id: itemId, action });
  }

  // Dispute: the consignor suggests a value (+ optional note) for the admin to decide.
  const suggested = Math.ceil(Number(b.suggested_value));
  if (!Number.isFinite(suggested) || suggested <= 0) {
    return NextResponse.json(
      { error: "Enter the replacement value you think is fair." },
      { status: 400 }
    );
  }
  const note = (b.note || "").toString().trim().slice(0, 500) || null;
  await sql`
    UPDATE items SET
      approval_status = 'disputed', disputed_at = now(),
      disputed_value = ${suggested}, dispute_note = ${note}, dispute_outcome = NULL
    WHERE id = ${itemId}
  `;
  // Alert the studio owner right away (best-effort).
  const cRow = await sql`SELECT name FROM consignors WHERE id = ${c.id}`;
  try {
    await sendDisputeAlert({
      consignorName: cRow[0]?.name ?? "A consignor",
      itemBrand: String(piece.brand),
      originalValue: Number(piece.replacement_value) || 0,
      suggestedValue: suggested,
      note,
    });
  } catch {
    /* non-fatal */
  }
  return NextResponse.json({ ok: true, item_id: itemId, action });
}
