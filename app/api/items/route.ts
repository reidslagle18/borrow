import { NextResponse } from "next/server";
import { sql, ensureSchema, nextItemId } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getProgram } from "@/lib/credits";
import { replacementDefault, cleanStyleTags, cleanOccasionTags } from "@/lib/types";
import { linkItemsIntoSet } from "@/lib/sets";

export async function GET() {
  await ensureSchema();
  const rows = await sql`
    SELECT i.*, c.name AS consignor_name, a.name AS ambassador_name,
      to_char(
        (SELECT MIN(r.start_date) FROM rentals r
          WHERE r.item_id = i.id AND r.status = 'reserved' AND r.start_date >= (now() AT TIME ZONE 'America/Chicago')::date),
        'YYYY-MM-DD'
      ) AS next_reservation_date
    FROM items i
    LEFT JOIN consignors c ON c.id = i.consignor_id
    LEFT JOIN ambassadors a ON a.id = i.ambassador_id
    ORDER BY i.created_at DESC
  `;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  // Adding a piece sets price/cost/replacement values — admin-only.
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const b = await request.json();

  if (!b.barcode || !b.brand || !b.size || !b.tier || b.rental_price == null) {
    return NextResponse.json(
      { error: "barcode, brand, size, tier and rental_price are required" },
      { status: 400 }
    );
  }

  const id = await nextItemId();
  const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
  const cover = b.photo_url || photos[0] || null;
  // Store all prices as whole dollars, rounded up — no stray cents.
  const rentalPrice = Math.ceil(Number(b.rental_price));
  const ceilOrNull = (v: unknown) =>
    v == null || v === "" ? null : Math.ceil(Number(v));
  const purchaseCost = ceilOrNull(b.purchase_cost);
  const retailValue = ceilOrNull(b.retail_value);
  // Replacement value: honor a hand-set value when the form marks it manual,
  // otherwise use the computed default (max of 70% retail, acquisition cost).
  const replDefault = replacementDefault(retailValue, purchaseCost);
  const sentRepl = ceilOrNull(b.replacement_value);
  const replacementManual = b.replacement_value_manual === true && sentRepl != null;
  const replacement = replacementManual ? (sentRepl as number) : replDefault;

  // Consignment pieces enter "Pending Consignor Approval" — staff can keep
  // editing; the piece only goes live once the consignor approves (enforced at
  // the shop feed + booking layer, so saving here is never blocked).
  const ownership = b.ownership || "owned";
  const desiredStatus = b.status || "available";
  const approvalStatus = ownership === "consignment" ? "pending" : null;
  const styleTags = cleanStyleTags(b.style_tags);
  const occasionTags = cleanOccasionTags(b.occasion_tags);
  const subOccasionTags = cleanOccasionTags(b.sub_occasion_tags);
  try {
    const rows = await sql`
      INSERT INTO items (
        id, barcode, name, brand, description, size, color, fabric, fit_notes,
        silhouette, style_tags, occasion_tags, sub_occasion_tags, new_with_tags, ambassador_id, tier, rental_price, purchase_cost,
        retail_value, replacement_value, replacement_value_manual, approval_status,
        acquisition_date, source, condition_notes, ownership,
        consignor_id, event_types, status, location, photo_url, photos
      ) VALUES (
        ${id}, ${String(b.barcode).trim()}, ${b.name || null}, ${b.brand}, ${b.description || null},
        ${b.size}, ${b.color || null}, ${b.fabric || null}, ${b.fit_notes || null},
        ${b.silhouette || null}, ${styleTags}, ${occasionTags}, ${subOccasionTags}, ${!!b.new_with_tags}, ${b.ambassador_id ?? null},
        ${b.tier}, ${rentalPrice},
        ${purchaseCost}, ${retailValue}, ${replacement}, ${replacementManual}, ${approvalStatus},
        ${b.acquisition_date || null}, ${b.source || null},
        ${b.condition_notes || null}, ${ownership},
        ${ownership === "consignment" ? b.consignor_id ?? null : null},
        ${b.event_types ?? []}, ${desiredStatus}, ${b.location || null},
        ${cover}, ${photos}
      )
      RETURNING *
    `;
    // Opt-in initial clean before first listing — only when the consignor
    // agreed. Deducts the Cleaning & Care Fee amount from their earnings.
    if (
      b.initial_clean &&
      b.ownership === "consignment" &&
      (b.consignor_id ?? null)
    ) {
      const fee = (await getProgram()).cleaning_fee;
      await sql`
        INSERT INTO consignor_charges (consignor_id, amount, kind, item_id, note)
        VALUES (${b.consignor_id}, ${fee}, 'initial', ${rows[0].id}, 'Initial clean before listing')
      `;
    }
    // Link into a matching set if a partner piece was chosen.
    if (b.set_partner_id) {
      const group = await linkItemsIntoSet(rows[0].id, String(b.set_partner_id));
      if (group) rows[0].set_group = group;
    }
    // The piece is left with approval_notified_at = NULL. The approval-
    // notifications cron is the single guaranteed sender: it batches every new
    // pending piece for a consignor into ONE email once their window closes, so
    // intake never has to (and can't accidentally skip) emailing them here.
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "That barcode is already used by another piece" },
        { status: 409 }
      );
    }
    throw err;
  }
}
