import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

/**
 * Server-to-server (x-api-key = BOOKING_API_KEY). Retrieve the live status of a
 * Stripe refund so we can tell whether a recorded refund actually went through
 * (succeeded / pending / failed / canceled) vs. is just still in transit.
 *
 * Body: { refund_id }  (re_...)
 */
export async function POST(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const b = await request.json().catch(() => ({}));
  const refundId = typeof b.refund_id === "string" ? b.refund_id : "";
  if (!refundId.startsWith("re_")) {
    return NextResponse.json({ error: "refund_id (re_...) required" }, { status: 400 });
  }
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });

  const r = await stripe.refunds.retrieve(refundId);
  return NextResponse.json({
    ok: true,
    id: r.id,
    status: r.status, // succeeded | pending | failed | canceled | requires_action
    amount: (r.amount ?? 0) / 100,
    currency: r.currency,
    reason: r.reason ?? null,
    failure_reason: r.failure_reason ?? null,
    created: r.created ? new Date(r.created * 1000).toISOString() : null,
  });
}
