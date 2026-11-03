import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { flushApprovalNotifications } from "@/lib/approvals";

/**
 * Sends batched "your items are ready to approve" emails (Vercel Cron — see
 * vercel.json). Runs frequently; each run emails one message per consignor
 * whose batch window has closed, covering every piece that became pending
 * within that window. This is the guaranteed notifier — item intake no longer
 * emails inline, so a piece can't slip through without being covered.
 *
 * Protected by CRON_SECRET when set (Vercel Cron sends it as a Bearer token).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  await ensureSchema();
  const { batches, items } = await flushApprovalNotifications();
  return NextResponse.json({ ok: true, batches, items });
}
