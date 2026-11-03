import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin, getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getProgram } from "@/lib/credits";
import { replacementDefault, cleanStyleTags, cleanOccasionTags } from "@/lib/types";
import { linkItemsIntoSet, unlinkFromSet } from "@/lib/sets";
import { sendItemPickupRequest, sendPickupNotice } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

// Looks up by the internal BRW id OR the scannable barcode, so the detail
// page (/inventory/[barcode]) and any id-based caller both resolve here.
export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const rows = await sql`
    SELECT i.*, c.name AS consignor_name, a.name AS ambassador_name,
           EXISTS (
             SELECT 1 FROM consignor_charges cc
             WHERE cc.item_id = i.id AND cc.kind = 'initial'
           ) AS initial_cleaned
    FROM items i
    LEFT JOIN consignors c ON c.id = i.consignor_id
    LEFT JOIN ambassadors a ON a.id = i.ambassador_id
    WHERE i.id = ${id} OR i.barcode = ${id}
    LIMIT 1
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

// Full update — the edit form always sends the complete item.
// Exception: { action: "rack" } puts a cleaned piece back in rotation.
export async function PATCH(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json();
  const session = await getSession(); // actor for the audit log

  // Staff-safe quick update: status + location only (no price/cost/value fields).
  // The full edit form below is admin-only.
  if (b.action === "update_fields") {
    const allowedStatus = [
      "available",
      "reserved",
      "rented",
      "cleaning",
      "consignor_hold",
      "with_consignor",
      "in_storage",
      "retired",
    ];
    const setStatus =
      typeof b.status === "string" && allowedStatus.includes(b.status);
    const setLocation = typeof b.location === "string" || b.location === null;
    if (!setStatus && !setLocation) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    let rows;
    if (setStatus && setLocation) {
      rows = await sql`UPDATE items SET status = ${b.status}, location = ${b.location || null}, updated_at = now() WHERE id = ${id} OR barcode = ${id} RETURNING *`;
    } else if (setStatus) {
      rows = await sql`UPDATE items SET status = ${b.status}, updated_at = now() WHERE id = ${id} OR barcode = ${id} RETURNING *`;
    } else {
      rows = await sql`UPDATE items SET location = ${b.location || null}, updated_at = now() WHERE id = ${id} OR barcode = ${id} RETURNING *`;
    }
    if (rows.length === 0)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    await logAudit(
      "item_update",
      {
        entity: "item",
        entityId: rows[0].id,
        detail: {
          ...(setStatus ? { status: b.status } : {}),
          ...(setLocation ? { location: b.location || null } : {}),
        },
      },
      session
    );
    return NextResponse.json(rows[0]);
  }

  // Apply the "initial clean before listing" charge after the fact — for when
  // the intake checkbox was missed. Deducts the Cleaning & Care Fee from the
  // consignor's earnings (same row the intake form creates). Idempotent: one
  // 'initial' charge per piece.
  if (b.action === "initial_clean") {
    const it = (
      await sql`SELECT id, ownership, consignor_id FROM items WHERE id = ${id}`
    )[0];
    if (!it) return NextResponse.json({ error: "Piece not found" }, { status: 404 });
    if (it.ownership !== "consignment" || !it.consignor_id) {
      return NextResponse.json(
        { error: "Initial cleaning only applies to a consignment piece." },
        { status: 400 }
      );
    }
    const existing = await sql`
      SELECT id FROM consignor_charges WHERE item_id = ${id} AND kind = 'initial'
    `;
    if (existing.length > 0) return NextResponse.json({ ok: true, already: true });
    const fee = (await getProgram()).cleaning_fee;
    await sql`
      INSERT INTO consignor_charges (consignor_id, amount, kind, item_id, note)
      VALUES (${it.consignor_id}, ${fee}, 'initial', ${id}, 'Initial clean before listing')
    `;
    return NextResponse.json({ ok: true, amount: fee });
  }

  if (b.action === "return_to_consignor") {
    const live = await sql`
      SELECT id FROM rentals
      WHERE item_id = ${id} AND status IN ('reserved','active')
    `;
    if (live.length > 0) {
      return NextResponse.json(
        { error: "This piece has live bookings — cancel or complete them first" },
        { status: 400 }
      );
    }
    // Was this piece back because the consignor requested it? (Determines the
    // automatic retrieval cleaning fee vs the manual dry-clean opt-in.)
    const openReq = await sql`
      SELECT id FROM retrieval_requests WHERE item_id = ${id} AND status = 'open'
    `;
    const hadOpenRetrieval = openReq.length > 0;
    const rows = await sql`
      UPDATE items SET
        status = 'retired',
        retrieval_hold_date = NULL,
        hold_start = NULL,
        hold_end = NULL,
        pickup_notice_sent_at = NULL,
        pickup_reminder_sent_at = NULL,
        storage_started_at = NULL,
        storage_decided_at = NULL,
        underperf_dismissed_at = NULL,
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Returned to consignor',
        updated_at = now()
      WHERE id = ${id} AND ownership = 'consignment'
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only consignment pieces can be returned to a consignor" },
        { status: 400 }
      );
    }
    if (rows[0].consignor_id) {
      const program = await getProgram();
      if (hadOpenRetrieval) {
        // Completing a consignor-requested retrieval: the configured cleaning
        // fee they were shown before confirming (Borrow cleans before returning).
        await sql`
          INSERT INTO consignor_charges (consignor_id, amount, kind, item_id, note)
          VALUES (${rows[0].consignor_id}, ${program.retrieval_cleaning_fee}, 'retrieval', ${id}, 'Retrieval cleaning fee')
        `;
      } else if (b.dry_clean) {
        // No request on file — the manual dry-clean opt-in still applies.
        await sql`
          INSERT INTO consignor_charges (consignor_id, amount, kind, item_id, note)
          VALUES (${rows[0].consignor_id}, ${program.cleaning_fee}, 'retrieval', ${id}, 'Dry clean at retrieval')
        `;
      }
    }
    // Close any open retrieval request now that it's handled.
    await sql`UPDATE retrieval_requests SET status = 'done', resolved_at = now() WHERE item_id = ${id} AND status = 'open'`;
    return NextResponse.json(rows[0]);
  }

  // Owner approves the underperformance pickup notice → email the consignor,
  // stamp the send time, and start the 30-day pickup clock. Nothing is emailed
  // until the owner explicitly approves here.
  if (b.action === "approve_pickup_notice") {
    const rows = await sql`
      SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS name,
             c.name AS consignor_name, c.email AS consignor_email
      FROM items i LEFT JOIN consignors c ON c.id = i.consignor_id
      WHERE i.id = ${id} AND i.ownership = 'consignment'
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only consignment pieces can be sent a pickup notice" },
        { status: 400 }
      );
    }
    const piece = rows[0];
    if (!piece.consignor_email) {
      return NextResponse.json(
        { error: "No email on file for this consignor — reach out directly instead." },
        { status: 400 }
      );
    }
    const deadline = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const deadlineDate = deadline.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const sent = await sendPickupNotice({
      to: String(piece.consignor_email),
      consignorName: String(piece.consignor_name || "there"),
      itemName: String(piece.name),
      deadlineDate,
    });
    if (!sent.sent) {
      return NextResponse.json(
        { error: "Couldn't send the email — check the email setup and try again." },
        { status: 502 }
      );
    }
    await sql`
      UPDATE items SET
        pickup_notice_sent_at = now(),
        pickup_reminder_sent_at = NULL,
        underperf_dismissed_at = NULL,
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Pickup notice sent (underperforming)',
        updated_at = now()
      WHERE id = ${id}
    `;
    return NextResponse.json({ ok: true, pickup_deadline: deadline.toISOString().slice(0, 10) });
  }

  // Owner gives an underperforming piece more time — resets its clock so it
  // won't re-flag until it crosses the threshold again from now.
  if (b.action === "dismiss_underperformance") {
    await sql`UPDATE items SET underperf_dismissed_at = now(), updated_at = now() WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  }

  // Owner acknowledges an unclaimed-in-storage piece (final decision is made
  // off-system) so it stops nagging in the notifications feed.
  if (b.action === "acknowledge_unclaimed") {
    await sql`UPDATE items SET storage_decided_at = now(), updated_at = now() WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  }

  // Studio asks the consignor to collect an under-performing piece: emails
  // them and stamps the ask so the "not renting" notification stops nagging.
  // The piece stays live until it's physically returned (then use
  // "return_to_consignor" to retire it).
  if (b.action === "request_pickup") {
    const rows = await sql`
      SELECT i.id, COALESCE(NULLIF(i.name, ''), i.brand) AS brand,
             c.name AS consignor_name, c.email AS consignor_email
      FROM items i LEFT JOIN consignors c ON c.id = i.consignor_id
      WHERE i.id = ${id} AND i.ownership = 'consignment'
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only consignment pieces can be sent back to a consignor" },
        { status: 400 }
      );
    }
    const piece = rows[0];
    if (!piece.consignor_email) {
      return NextResponse.json(
        {
          error:
            "No email on file for this consignor — reach out to them directly to arrange pickup.",
        },
        { status: 400 }
      );
    }
    const sent = await sendItemPickupRequest({
      to: String(piece.consignor_email),
      consignorName: String(piece.consignor_name || "there"),
      itemBrand: String(piece.brand),
    });
    if (!sent.sent) {
      return NextResponse.json(
        { error: "Couldn't send the email — check the email setup and try again." },
        { status: 502 }
      );
    }
    const updated = await sql`
      UPDATE items SET
        pickup_requested_at = now(),
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Asked consignor to collect (low rentals)',
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return NextResponse.json(updated[0]);
  }

  // A consignor borrows their own piece back — free, open-ended, blocked from
  // others until returned. Stays in the system as 'with_consignor'.
  if (b.action === "consignor_take") {
    const live = await sql`
      SELECT id FROM rentals WHERE item_id = ${id} AND status IN ('reserved','active')
    `;
    if (live.length > 0) {
      return NextResponse.json(
        { error: "This piece has live bookings — cancel or complete them first" },
        { status: 400 }
      );
    }
    const openTakeReq = await sql`
      SELECT id FROM retrieval_requests WHERE item_id = ${id} AND status = 'open'
    `;
    const hadOpenTake = openTakeReq.length > 0;
    const rows = await sql`
      UPDATE items SET
        status = 'with_consignor',
        retrieval_hold_date = NULL,
        hold_start = NULL,
        hold_end = NULL,
        pickup_notice_sent_at = NULL,
        pickup_reminder_sent_at = NULL,
        storage_started_at = NULL,
        storage_decided_at = NULL,
        underperf_dismissed_at = NULL,
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Out to consignor — must be returned clean',
        updated_at = now()
      WHERE id = ${id} AND ownership = 'consignment'
        AND status NOT IN ('retired','rented')
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only an available consignment piece can go out to its consignor" },
        { status: 400 }
      );
    }
    // Fulfilling a consignor-requested retrieval → the configured cleaning fee.
    if (hadOpenTake && rows[0].consignor_id) {
      const program = await getProgram();
      await sql`
        INSERT INTO consignor_charges (consignor_id, amount, kind, item_id, note)
        VALUES (${rows[0].consignor_id}, ${program.retrieval_cleaning_fee}, 'retrieval', ${id}, 'Retrieval cleaning fee')
      `;
    }
    // Close any open retrieval request now that it's handled.
    await sql`UPDATE retrieval_requests SET status = 'done', resolved_at = now() WHERE item_id = ${id} AND status = 'open'`;
    return NextResponse.json(rows[0]);
  }

  if (b.action === "consignor_return") {
    const rows = await sql`
      UPDATE items SET
        status = 'available',
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Returned by consignor',
        updated_at = now()
      WHERE id = ${id} AND status = 'with_consignor'
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "This piece isn't currently out to its consignor" },
        { status: 400 }
      );
    }
    return NextResponse.json(rows[0]);
  }

  // Mark a consignor self-hold as returned. The owner is prompted clean vs
  // needs-cleaning: clean → straight back on the rack (available); needs
  // cleaning → into cleaning AND the cleaning fee is deducted from the
  // consignor's earnings ledger. No late fee ever applies to a self-hold.
  if (b.action === "hold_return") {
    const needsCleaning = b.needs_cleaning === true;
    const rows = await sql`
      UPDATE items SET
        status = ${needsCleaning ? "cleaning" : "available"},
        hold_start = NULL,
        hold_end = NULL,
        retrieval_hold_date = NULL,
        condition_notes = COALESCE(condition_notes || E'\n', '') ||
          '[' || (now() AT TIME ZONE 'America/Chicago')::date || '] Returned from consignor hold' ||
          ${needsCleaning ? " (needs cleaning)" : " (clean)"},
        updated_at = now()
      WHERE id = ${id} AND status = 'consignor_hold'
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "This piece isn't currently on a consignor hold" },
        { status: 400 }
      );
    }
    if (needsCleaning && rows[0].consignor_id) {
      const program = await getProgram();
      await sql`
        INSERT INTO consignor_charges (consignor_id, amount, kind, item_id, note)
        VALUES (${rows[0].consignor_id}, ${program.retrieval_cleaning_fee}, 'retrieval', ${id}, 'Cleaning fee — self-hold return')
      `;
    }
    // Close the open self-hold request now that the piece is back.
    await sql`UPDATE retrieval_requests SET status = 'done', resolved_at = now() WHERE item_id = ${id} AND status = 'open'`;
    await logAudit("hold_return", { entity: "item", entityId: id, detail: { needs_cleaning: needsCleaning } }, session);
    return NextResponse.json(rows[0]);
  }

  if (b.action === "rack") {
    const rows = await sql`
      UPDATE items SET status = CASE
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${id} AND status = 'active') THEN 'rented'
        WHEN EXISTS (SELECT 1 FROM rentals WHERE item_id = ${id} AND status = 'reserved') THEN 'reserved'
        ELSE 'available'
      END, updated_at = now()
      WHERE id = ${id} AND status = 'cleaning'
      RETURNING *
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Only pieces in cleaning can go back on the rack" },
        { status: 400 }
      );
    }
    return NextResponse.json(rows[0]);
  }

  // Star / un-star a piece as Featured (admin only). Turning it on appends it to
  // the end of the featured order; turning it off clears its rank. The featured
  // flag is never touched by the full edit form below, so it persists.
  if (b.action === "toggle_featured") {
    if (!(await requireAdmin()))
      return NextResponse.json({ error: "Admins only" }, { status: 403 });
    const on = b.featured === true;
    let rows;
    if (on) {
      rows = await sql`
        UPDATE items SET
          featured = true,
          featured_rank = COALESCE(
            featured_rank,
            (SELECT COALESCE(MAX(featured_rank), 0) + 1 FROM items WHERE featured)
          ),
          updated_at = now()
        WHERE id = ${id} OR barcode = ${id}
        RETURNING *`;
    } else {
      rows = await sql`
        UPDATE items SET featured = false, featured_rank = NULL, updated_at = now()
        WHERE id = ${id} OR barcode = ${id}
        RETURNING *`;
    }
    if (rows.length === 0)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    await logAudit("item_featured", { entity: "item", entityId: rows[0].id, detail: { featured: on } }, session);
    return NextResponse.json(rows[0]);
  }

  // Staff-side approval resolution (e.g. after an in-person dispute review):
  // approve the value directly, or reset a disputed piece back to pending so
  // the consignor can approve it again.
  if (b.action === "approval") {
    // Staff approves the value directly (e.g. in person).
    if (b.approval_action === "approve") {
      const rows = await sql`
        UPDATE items SET approval_status = 'approved', approved_at = now(),
          disputed_at = NULL, disputed_value = NULL, dispute_note = NULL, dispute_outcome = NULL
        WHERE id = ${id} AND ownership = 'consignment' RETURNING *
      `;
      if (rows.length === 0)
        return NextResponse.json({ error: "Not a consignment piece" }, { status: 400 });
      return NextResponse.json(rows[0]);
    }
    // Accept the consignor's suggested value → becomes the replacement value,
    // back to pending for their final sign-off.
    if (b.approval_action === "accept_suggested") {
      const rows = await sql`
        UPDATE items SET
          replacement_value = disputed_value,
          replacement_value_manual = true,
          approval_status = 'pending',
          dispute_outcome = 'accepted',
          disputed_at = NULL
        WHERE id = ${id} AND ownership = 'consignment' AND disputed_value IS NOT NULL
        RETURNING *
      `;
      if (rows.length === 0)
        return NextResponse.json({ error: "No suggested value to accept" }, { status: 400 });
      return NextResponse.json(rows[0]);
    }
    // Reject the suggestion → keep the admin value, back to pending, note the outcome.
    if (b.approval_action === "reject_suggested") {
      const rows = await sql`
        UPDATE items SET
          approval_status = 'pending',
          dispute_outcome = 'rejected',
          disputed_at = NULL
        WHERE id = ${id} AND ownership = 'consignment'
        RETURNING *
      `;
      if (rows.length === 0)
        return NextResponse.json({ error: "Not a consignment piece" }, { status: 400 });
      return NextResponse.json(rows[0]);
    }
    return NextResponse.json({ error: "Unknown approval_action" }, { status: 400 });
  }

  // Everything below is the full edit form — it rewrites price, cost, retail and
  // replacement values — so it is admin-only. Staff use action:"update_fields"
  // (status/location) above.
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });

  if (!b.barcode || !b.brand || !b.size || !b.tier || b.rental_price == null) {
    return NextResponse.json(
      { error: "barcode, brand, size, tier and rental_price are required" },
      { status: 400 }
    );
  }

  const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
  const cover = b.photo_url || photos[0] || null;
  // Whole-dollar prices, rounded up — no stray cents.
  const rentalPrice = Math.ceil(Number(b.rental_price));
  const ceilOrNull = (v: unknown) =>
    v == null || v === "" ? null : Math.ceil(Number(v));
  const purchaseCost = ceilOrNull(b.purchase_cost);
  const retailValue = ceilOrNull(b.retail_value);
  // Resolve replacement value: honor the form's manual flag (never overwrite a
  // hand-set value); otherwise recompute the default from the current retail
  // value / acquisition cost.
  const replDefault = replacementDefault(retailValue, purchaseCost);
  const sentRepl = ceilOrNull(b.replacement_value);
  const replacementManual = b.replacement_value_manual === true && sentRepl != null;
  const replacement = replacementManual ? (sentRepl as number) : replDefault;

  // Editing is never blocked — a consignment piece stays "Pending Consignor
  // Approval" until the consignor approves; go-live is gated at the shop feed +
  // booking layer, not here. A piece that BECOMES consignment (and has no
  // approval yet) enters 'pending'; a piece leaving consignment clears it.
  const ownership = b.ownership || "owned";
  // Stamp the retirement date when a piece is first moved to retired.
  const retiredAt = b.status === "retired" ? b.retired_at ?? null : null;

  let rows;
  try {
    rows = await sql`
      UPDATE items SET
        barcode = ${String(b.barcode).trim()},
        name = ${b.name || null},
        brand = ${b.brand},
        description = ${b.description || null},
        size = ${b.size},
        color = ${b.color || null},
        fabric = ${b.fabric || null},
        fit_notes = ${b.fit_notes || null},
        silhouette = ${b.silhouette || null},
        style_tags = ${cleanStyleTags(b.style_tags)},
        occasion_tags = ${cleanOccasionTags(b.occasion_tags)},
        sub_occasion_tags = ${cleanOccasionTags(b.sub_occasion_tags)},
        new_with_tags = ${!!b.new_with_tags},
        ambassador_id = ${b.ambassador_id ?? null},
        tier = ${b.tier},
        rental_price = ${rentalPrice},
        purchase_cost = ${purchaseCost},
        retail_value = ${retailValue},
        replacement_value = ${replacement},
        replacement_value_manual = ${replacementManual},
        approval_status = CASE
          WHEN ${ownership} = 'consignment' AND approval_status IS NULL THEN 'pending'
          WHEN ${ownership} <> 'consignment' THEN NULL
          ELSE approval_status
        END,
        acquisition_date = ${b.acquisition_date || null},
        source = ${b.source || null},
        condition_notes = ${b.condition_notes || null},
        ownership = ${b.ownership || "owned"},
        consignor_id = ${b.ownership === "consignment" ? b.consignor_id ?? null : null},
        event_types = ${b.event_types ?? []},
        status = ${b.status || "available"},
        location = ${b.location || null},
        photo_url = ${cover},
        photos = ${photos},
        retired_at = CASE
          WHEN ${b.status} = 'retired' THEN COALESCE(${retiredAt}, retired_at, (now() AT TIME ZONE 'America/Chicago')::date)
          ELSE NULL
        END,
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "That barcode is already used by another piece" },
        { status: 409 }
      );
    }
    throw err;
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Matching-set link/unlink (kept separate so a normal edit never disturbs it).
  if (b.set_unlink === true) {
    await unlinkFromSet(id);
    rows[0].set_group = null;
  } else if (b.set_partner_id) {
    const group = await linkItemsIntoSet(id, String(b.set_partner_id));
    if (group) rows[0].set_group = group;
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  await ensureSchema();
  const { id } = await ctx.params;
  const rows = await sql`DELETE FROM items WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
