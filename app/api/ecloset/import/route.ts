import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendConsignorRentedEmail } from "@/lib/email";

/**
 * Import e.closet Orders (from their Orders → Export CSV). The screen parses the
 * CSV and applies the owner's column mapping, then sends normalized rows here.
 *
 *   POST { rows, commit:false }  → a PREVIEW: each row matched to a Borrow piece,
 *                                  with its consignor + the payout that will be
 *                                  queued, plus warnings (no match / already in).
 *   POST { rows, commit:true }   → creates a reserved e.closet rental per row
 *                                  (blocks the dates on Borrow), flags the piece
 *                                  as listed_on_ecloset, and QUEUES the consignor
 *                                  their cut (rate × the piece's rental price) as
 *                                  a pending payout — the same payout pipeline
 *                                  Borrow rentals use. Deduped by e.closet order
 *                                  id, so re-importing the same file is a no-op.
 *
 * Normalized row: { order_id, item_key, buyer?, amount?, start_date?, due_date? }
 * item_key is matched to a piece by barcode first, then by name.
 */
type Row = {
  order_id?: string;
  item_key?: string;
  buyer?: string;
  amount?: string | number;
  start_date?: string;
  due_date?: string;
};

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function matchItem(key: string) {
  const k = (key || "").trim();
  if (!k) return null;
  // Barcode / SKU exact first (most reliable), then a name/brand contains match.
  const byCode = await sql`
    SELECT id, barcode, COALESCE(NULLIF(name,''), brand) AS name, rental_price, ownership, consignor_id, status
    FROM items WHERE barcode = ${k} LIMIT 1`;
  if (byCode.length) return byCode[0];
  const byName = await sql`
    SELECT id, barcode, COALESCE(NULLIF(name,''), brand) AS name, rental_price, ownership, consignor_id, status
    FROM items
    WHERE COALESCE(NULLIF(name,''), brand) ILIKE ${"%" + k + "%"}
    ORDER BY (COALESCE(NULLIF(name,''), brand) = ${k}) DESC
    LIMIT 2`;
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return { ambiguous: true } as const;
  return null;
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json().catch(() => ({}));
  const rows: Row[] = Array.isArray(body.rows) ? body.rows : [];
  const commit = body.commit === true;

  const results: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    const orderId = String(r.order_id ?? "").trim();
    const itemKey = String(r.item_key ?? "").trim();
    const amount = r.amount != null && r.amount !== "" ? Number(r.amount) : null;
    const start = isDate(r.start_date) ? (r.start_date as string) : null;
    const due = isDate(r.due_date) ? (r.due_date as string) : null;

    const base: Record<string, unknown> = {
      order_id: orderId,
      item_key: itemKey,
      buyer: r.buyer ?? null,
      amount,
      start_date: start,
      due_date: due,
    };

    // Already imported? (dedupe by e.closet order id)
    if (orderId) {
      const dupe = await sql`SELECT id FROM rentals WHERE ecloset_order_id = ${orderId} LIMIT 1`;
      if (dupe.length) {
        results.push({ ...base, status: "already_imported", warning: "This order is already in Borrow." });
        continue;
      }
    }

    const m = await matchItem(itemKey);
    if (!m) {
      results.push({ ...base, status: "no_match", warning: "No Borrow piece matches — check the SKU/name." });
      continue;
    }
    if ("ambiguous" in m) {
      results.push({ ...base, status: "ambiguous", warning: "Matches more than one piece — use the barcode/SKU." });
      continue;
    }

    const isConsignment = m.ownership === "consignment" && m.consignor_id;
    let consignorName: string | null = null;
    let consignorEmail: string | null = null;
    let portalCode: string | null = null;
    let rate = 0;
    if (isConsignment) {
      const c = await sql`SELECT name, email, portal_code, COALESCE(consignor_rate,60) AS rate FROM consignors WHERE id = ${m.consignor_id}`;
      consignorName = c[0]?.name ?? null;
      consignorEmail = c[0]?.email ?? null;
      portalCode = c[0]?.portal_code ?? null;
      rate = Number(c[0]?.rate ?? 0);
    }
    const priceBasis = Number(m.rental_price) || 0;
    // Consignor gets their normal in-store cut (paid on return) — no e.closet bonus.
    const payout = isConsignment ? Math.round(priceBasis * (rate / 100) * 100) / 100 : 0;

    const matchInfo = {
      ...base,
      item_id: m.id,
      item_name: m.name,
      item_barcode: m.barcode,
      price_basis: priceBasis,
      ownership: m.ownership,
      consignor_name: consignorName,
      consignor_rate: rate,
      payout,
    };

    if (!commit) {
      const needDates = !start || !due;
      results.push({
        ...matchInfo,
        status: needDates ? "needs_dates" : "ready",
        warning: needDates ? "Add the rental dates before importing." : null,
      });
      continue;
    }

    // COMMIT — must have dates.
    if (!start || !due) {
      results.push({ ...matchInfo, status: "skipped", warning: "Skipped — missing dates." });
      continue;
    }

    const notes = `e.closet order ${orderId || "?"}${r.buyer ? ` · ${r.buyer}` : ""}${amount != null ? ` · charged $${amount}` : ""}`;
    const ins = await sql`
      INSERT INTO rentals (
        item_id, customer_id, start_date, due_date, status,
        rental_price, damage_waiver, cleaning_fee, sales_tax, notes, source,
        paid, ecloset_order_id, ecloset_amount
      ) VALUES (
        ${m.id}, ${null}, ${start}, ${due}, 'reserved',
        ${priceBasis}, false, 0, 0, ${notes}, 'ecloset',
        true, ${orderId || null}, ${amount}
      )
      ON CONFLICT (ecloset_order_id) WHERE ecloset_order_id IS NOT NULL DO NOTHING
      RETURNING id
    `;
    if (!ins.length) {
      results.push({ ...matchInfo, status: "already_imported", warning: "Already imported (raced)." });
      continue;
    }
    const rentalId = Number(ins[0].id);

    // Flag the piece as cross-listed (so the Sync-to-e.closet checklist knows).
    // Block it on Borrow: reserved unless it's currently out on an active rental.
    await sql`UPDATE items SET listed_on_ecloset = true, updated_at = now() WHERE id = ${m.id}`;
    await sql`UPDATE items SET status = 'reserved', updated_at = now()
              WHERE id = ${m.id} AND status = 'available'`;

    // The consignor payout is NOT queued now — it fires when the rental returns
    // (like an in-store order), via the e.closet settle cron. Email them it rented.
    if (isConsignment && consignorEmail) {
      await sendConsignorRentedEmail({
        to: consignorEmail,
        consignorName: consignorName ?? "",
        brand: String(m.name),
        earned: payout,
        portalCode,
      }).catch(() => {});
    }

    results.push({ ...matchInfo, status: "imported", rental_id: rentalId });
  }

  const summary = results.reduce<Record<string, number>>((a, r) => {
    const s = String(r.status);
    a[s] = (a[s] || 0) + 1;
    return a;
  }, {});
  return NextResponse.json({ rows: results, summary });
}
