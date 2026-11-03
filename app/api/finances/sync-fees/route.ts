import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { syncStripeFees } from "@/lib/stripe-fees";

/** Admin-only (gated by proxy.ts): fill in missing Stripe fees on demand. */
export async function POST() {
  await ensureSchema();
  const res = await syncStripeFees(300);
  return NextResponse.json({ ok: true, ...res });
}
