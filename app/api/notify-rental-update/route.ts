import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendRentalDatesUpdate } from "@/lib/email";

/**
 * Admin-only (gated by proxy.ts): email a customer that their rental dates
 * changed (pickup and/or return moved). Content is templated server-side; the
 * body only supplies who, which pieces, and the new date labels. Refuses any
 * address that isn't a customer on file so it can't be repurposed.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const email = String(b?.email || "").trim();
  const name = String(b?.name || "").trim();
  const pieces = Array.isArray(b?.pieces) ? b.pieces.map((p: unknown) => String(p)) : [];
  const pickupLabel = String(b?.pickup || "").trim();
  const returnLabel = String(b?.return_by || "").trim();

  if (!email || pieces.length === 0 || !pickupLabel || !returnLabel) {
    return NextResponse.json(
      { error: "email, pieces, pickup and return_by are required" },
      { status: 400 }
    );
  }
  const known = await sql`SELECT 1 FROM customers WHERE lower(email) = lower(${email}) LIMIT 1`;
  if (known.length === 0) {
    return NextResponse.json({ error: "not a customer on file" }, { status: 400 });
  }

  const res = await sendRentalDatesUpdate({
    to: email,
    firstName: name.split(" ")[0] || "there",
    pieces,
    pickupLabel,
    returnLabel,
  });
  if (!res.sent) {
    return NextResponse.json(
      { error: res.error || "Couldn't send the email." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, sent: true, to: email });
}
