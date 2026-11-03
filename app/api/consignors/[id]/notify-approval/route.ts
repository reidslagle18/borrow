import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { sendApprovalRequest } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

/** Manually (re)email a consignor that they have pieces awaiting approval —
 *  covers ALL their pending pieces, in case the batched email was missed.
 *  Warns (409) if one was already sent within the batch window unless the
 *  caller passes { force: true }. */
export async function POST(req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;

  const windowMin = Math.max(
    1,
    Math.floor(Number((await getProgram()).approval_batch_window_min) || 60)
  );

  const rows = await sql`
    SELECT c.name, c.email, c.portal_code, c.approval_email_sent_at,
      (c.approval_email_sent_at IS NOT NULL
        AND now() - c.approval_email_sent_at < ${windowMin}::int * interval '1 minute') AS sent_recently
    FROM consignors c WHERE c.id = ${id}
  `;
  const c = rows[0];
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!c.email) {
    return NextResponse.json(
      { error: "This consignor has no email on file — add one first." },
      { status: 400 }
    );
  }

  const pending = await sql`
    SELECT id, COALESCE(NULLIF(name, ''), brand) AS label
    FROM items
    WHERE consignor_id = ${id} AND approval_status IN ('pending', 'disputed')
    ORDER BY created_at
  `;
  if (pending.length === 0) {
    return NextResponse.json(
      { error: "This consignor has no items awaiting approval." },
      { status: 400 }
    );
  }
  // Emailed recently, and not an explicit re-send → warn with a clear note.
  if (c.sent_recently && !force) {
    return NextResponse.json(
      {
        already_sent_recently: true,
        error: "You already emailed this consignor recently. Send another anyway?",
      },
      { status: 409 }
    );
  }

  const r = await sendApprovalRequest({
    to: c.email,
    consignorName: c.name,
    count: pending.length,
    portalCode: c.portal_code,
    itemNames: pending.map((p) => String(p.label)),
  });
  if (!r.sent) {
    return NextResponse.json(
      { error: "Couldn't send the email (is email configured?)." },
      { status: 502 }
    );
  }
  // Stamp the consignor and every pending piece as notified now, so the
  // batching cron treats them as covered and won't re-send.
  await sql`UPDATE consignors SET approval_email_sent_at = now() WHERE id = ${id}`;
  await sql`
    UPDATE items SET approval_notified_at = now()
    WHERE consignor_id = ${id} AND approval_status IN ('pending', 'disputed')
  `;
  return NextResponse.json({ ok: true, count: pending.length });
}
