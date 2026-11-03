import { sql } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { sendApprovalRequest } from "@/lib/email";

/**
 * Batched consignor approval notifications.
 *
 * Every consignment piece enters "Pending Consignor Approval" with
 * approval_notified_at = NULL. This sweep (run by the cron) is the single,
 * reliable sender: for each consignor it anchors a batch at their oldest
 * un-notified pending piece and, once the configurable window has elapsed,
 * emails ONE message covering every piece that entered within that window,
 * then stamps each piece (and the consignor's last-emailed time). Pieces that
 * arrive after the window naturally start a fresh batch and a new email.
 *
 * Because it's idempotent and predicate-driven, a piece is never emailed twice
 * and never silently skipped — a failed send just leaves it un-notified to
 * retry next run.
 */
export async function flushApprovalNotifications(): Promise<{
  batches: number;
  items: number;
}> {
  const windowMin = Math.max(
    1,
    Math.floor(Number((await getProgram()).approval_batch_window_min) || 60)
  );

  // Consignors whose oldest un-notified pending piece is at least `window`
  // minutes old — their collection window has closed, so the batch is ready.
  const ready = await sql`
    SELECT c.id, c.name, c.email, c.portal_code, MIN(i.created_at) AS anchor
    FROM items i
    JOIN consignors c ON c.id = i.consignor_id
    WHERE i.ownership = 'consignment'
      AND i.approval_status = 'pending'
      AND i.approval_notified_at IS NULL
      AND c.email IS NOT NULL
    GROUP BY c.id, c.name, c.email, c.portal_code
    HAVING now() - MIN(i.created_at) >= ${windowMin}::int * interval '1 minute'
  `;

  let batches = 0;
  let items = 0;
  for (const c of ready) {
    // The batch = pending, un-notified pieces that entered within `window`
    // minutes of the anchor. Anything newer belongs to the next batch.
    const batch = await sql`
      SELECT id, COALESCE(NULLIF(name, ''), brand) AS label
      FROM items
      WHERE consignor_id = ${c.id}
        AND ownership = 'consignment'
        AND approval_status = 'pending'
        AND approval_notified_at IS NULL
        AND created_at < ${c.anchor}::timestamptz + ${windowMin}::int * interval '1 minute'
      ORDER BY created_at
    `;
    if (batch.length === 0) continue;

    const r = await sendApprovalRequest({
      to: String(c.email),
      consignorName: String(c.name),
      count: batch.length,
      portalCode: c.portal_code,
      itemNames: batch.map((b) => String(b.label)),
    });
    if (!r.sent) continue; // leave un-notified so a later run retries

    // Stamp exactly the pieces this email covered, plus the consignor's
    // last-emailed time (same predicate → no double-send, no new item can slip
    // in because the window has already elapsed).
    await sql`
      UPDATE items SET approval_notified_at = now()
      WHERE consignor_id = ${c.id}
        AND ownership = 'consignment'
        AND approval_status = 'pending'
        AND approval_notified_at IS NULL
        AND created_at < ${c.anchor}::timestamptz + ${windowMin}::int * interval '1 minute'
    `;
    await sql`UPDATE consignors SET approval_email_sent_at = now() WHERE id = ${c.id}`;
    batches++;
    items += batch.length;
  }
  return { batches, items };
}
