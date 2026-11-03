import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { normalizeCode } from "@/lib/campaigns";

/**
 * Studio (session-gated): add or remove a campaign tag on an order after the
 * fact, logging who and when. Body:
 *   { order_key, code, action: 'add'|'remove', actor? }
 * order_key is the Orders-list key: 'txn:<id>' (in-store), a Stripe session id
 * (online), or 'r<id>' (standalone rental).
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const orderKey = String(b.order_key || "");
  const action = b.action === "remove" ? "remove" : "add";
  const actor = (typeof b.actor === "string" && b.actor.trim()) || "studio admin";
  const code = normalizeCode(b.code);
  if (!orderKey) return NextResponse.json({ error: "order_key required" }, { status: 400 });
  if (action === "add" && !code) {
    return NextResponse.json({ error: "code required to add a tag" }, { status: 400 });
  }
  if (action === "add") {
    const exists = await sql`SELECT 1 FROM campaigns WHERE upper(code) = ${code} LIMIT 1`;
    if (exists.length === 0) {
      return NextResponse.json({ error: `No campaign with code ${code}.` }, { status: 400 });
    }
  }

  // Resolve the order's rentals from its key.
  let rentals: { id: number }[] = [];
  let txnId: number | null = null;
  if (orderKey.startsWith("txn:")) {
    txnId = Number(orderKey.slice(4)) || null;
    rentals = await sql`SELECT id FROM rentals WHERE transaction_id = ${txnId}`;
  } else if (/^r\d+$/.test(orderKey)) {
    rentals = await sql`SELECT id FROM rentals WHERE id = ${Number(orderKey.slice(1))}`;
  } else {
    rentals = await sql`SELECT id FROM rentals WHERE stripe_session_id = ${orderKey}`;
  }
  if (rentals.length === 0) {
    return NextResponse.json({ error: "No rentals found for that order." }, { status: 404 });
  }
  const ids = rentals.map((r) => r.id);
  const newCode = action === "add" ? code : null;
  await sql`UPDATE rentals SET campaign_code = ${newCode}, updated_at = now() WHERE id = ANY(${ids})`;

  // Audit log (one row per order).
  await sql`
    INSERT INTO campaign_tag_log (rental_id, transaction_id, code, action, actor)
    VALUES (${ids[0]}, ${txnId}, ${code || "—"}, ${action}, ${actor})
  `.catch(() => {});

  return NextResponse.json({ ok: true, action, code: newCode, rentals: ids.length });
}
