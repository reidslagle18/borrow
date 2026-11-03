import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendPickupNoticeBatch } from "@/lib/email";

/**
 * Batch pickup notice: the owner selects several underperforming pieces and
 * sends ONE email per consignor listing all of their selected pieces, instead of
 * one email per piece. Each emailed piece gets its 30-day pickup clock started
 * (same effect as the per-row "Approve & Send"). Pieces whose consignor has no
 * email on file are skipped and reported back.
 *
 * Gated by the studio session cookie (see proxy.ts). Body: { item_ids: string[] }.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.item_ids)
    ? b.item_ids.map((x: unknown) => String(x)).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No pieces selected" }, { status: 400 });
  }

  // Pull the selected consignment pieces with their consignor + email.
  const rows = await sql`
    SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS name,
           c.id AS consignor_id, c.name AS consignor_name, c.email AS consignor_email
    FROM items i
    LEFT JOIN consignors c ON c.id = i.consignor_id
    WHERE i.id = ANY(${ids}) AND i.ownership = 'consignment'
  `;
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "None of the selected pieces are consignment pieces." },
      { status: 400 }
    );
  }

  // Group selected pieces by consignor so each person gets a single email.
  const groups = new Map<
    number,
    { name: string; email: string | null; items: { id: string; name: string }[] }
  >();
  for (const r of rows) {
    const key = Number(r.consignor_id);
    if (!groups.has(key)) {
      groups.set(key, {
        name: String(r.consignor_name || "there"),
        email: r.consignor_email ? String(r.consignor_email) : null,
        items: [],
      });
    }
    groups.get(key)!.items.push({ id: String(r.id), name: String(r.name) });
  }

  const deadline = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const deadlineDate = deadline.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const sent: { consignor: string; count: number }[] = [];
  const skipped: { consignor: string; reason: string }[] = [];

  for (const g of groups.values()) {
    if (!g.email) {
      skipped.push({ consignor: g.name, reason: "no email on file" });
      continue;
    }
    const emailed = await sendPickupNoticeBatch({
      to: g.email,
      consignorName: g.name,
      itemNames: g.items.map((it) => it.name),
      deadlineDate,
    });
    if (!emailed.sent) {
      skipped.push({ consignor: g.name, reason: "email failed to send" });
      continue;
    }
    // Start the 30-day pickup clock on each emailed piece (mirrors
    // approve_pickup_notice on app/api/items/[id]).
    const itemIds = g.items.map((it) => it.id);
    await sql`
      UPDATE items SET
        pickup_notice_sent_at = now(),
        pickup_reminder_sent_at = NULL,
        underperf_dismissed_at = NULL,
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Pickup notice sent (underperforming, batch)',
        updated_at = now()
      WHERE id = ANY(${itemIds})
    `;
    sent.push({ consignor: g.name, count: g.items.length });
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    pickup_deadline: deadline.toISOString().slice(0, 10),
  });
}
