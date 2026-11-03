import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sendDueDateExtension } from "@/lib/email";

/**
 * Admin-only (gated by proxy.ts): send the "your return date moved later, on
 * us" note to a set of renters after a store closure. One email per recipient,
 * listing their affected pieces. Content is templated server-side; the body
 * only supplies who + which pieces, and we refuse any address that isn't a
 * customer on file, so it can't be repurposed to mail arbitrary people.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const recipients = Array.isArray(b.recipients) ? b.recipients : [];
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No recipients provided" }, { status: 400 });
  }

  const results: { email: string; sent: boolean; error?: string }[] = [];
  for (const r of recipients) {
    const email = String(r?.email || "").trim();
    const name = String(r?.name || "").trim();
    const pieces = Array.isArray(r?.pieces) ? r.pieces.map((p: unknown) => String(p)) : [];
    if (!email || pieces.length === 0) {
      results.push({ email, sent: false, error: "missing email or pieces" });
      continue;
    }
    const known = await sql`SELECT 1 FROM customers WHERE lower(email) = lower(${email}) LIMIT 1`;
    if (known.length === 0) {
      results.push({ email, sent: false, error: "not a customer on file" });
      continue;
    }
    const res = await sendDueDateExtension({
      to: email,
      firstName: name.split(" ")[0] || "there",
      pieces,
    });
    results.push({ email, sent: res.sent, error: res.error });
  }

  return NextResponse.json({ ok: true, sent: results.filter((r) => r.sent).length, results });
}
