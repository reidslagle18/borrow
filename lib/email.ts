import { Resend } from "resend";
import { AGREEMENT_TERMS } from "./types";

export interface ReceiptLine {
  brand: string;
  barcode: string;
  rental_price: number;
  waiver: number;
}

export interface ReceiptData {
  to: string;
  customerName: string;
  lines: ReceiptLine[];
  subtotal: number;
  waiverTotal: number;
  total: number;
  startDate: string;
  dueDate: string;
  agreementName: string;
  transactionId: number;
}

function money(n: number): string {
  return `$${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;
}

function receiptHtml(d: ReceiptData): string {
  const rows = d.lines
    .map(
      (l) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">
            ${l.brand} <span style="color:#999;font-family:monospace;">${l.barcode}</span>
          </td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">
            ${money(l.rental_price)} + ${money(l.waiver)} waiver
          </td>
        </tr>`
    )
    .join("");

  const terms = AGREEMENT_TERMS.map((t) => `<li style="margin:4px 0;">${t}</li>`).join("");

  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-style:italic;font-size:32px;margin:0 0 4px;">BORROW</h1>
    <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Rental Receipt</p>
    <p>Hi ${d.customerName || "there"}, thanks for renting with BORROW. Here's your receipt.</p>
    <table style="width:100%;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:14px;margin:16px 0;">
      ${rows}
      <tr><td style="padding:8px 0;">Subtotal</td><td style="padding:8px 0;text-align:right;">${money(d.subtotal)}</td></tr>
      <tr><td style="padding:4px 0;">Damage waivers</td><td style="padding:4px 0;text-align:right;">${money(d.waiverTotal)}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #1a1a1a;">Total</td>
          <td style="padding:8px 0;text-align:right;font-weight:bold;border-top:2px solid #1a1a1a;">${money(d.total)}</td></tr>
    </table>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;">
      Rental period: <strong>${d.startDate}</strong> &rarr; <strong>${d.dueDate}</strong><br/>
      Order #${d.transactionId}
    </p>
    <h3 style="margin:24px 0 8px;">Rental Agreement</h3>
    <ul style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#444;padding-left:18px;">${terms}</ul>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#888;">
      Accepted by ${d.agreementName || d.customerName} at checkout.
    </p>
  </div>`;
}

/**
 * Sends the rental receipt + agreement. Best-effort: if RESEND_API_KEY isn't
 * configured the checkout still succeeds and this resolves false, so email can
 * be switched on later without code changes.
 */
export async function sendReceipt(
  d: ReceiptData
): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, error: "email-not-configured" };
  if (!d.to) return { sent: false, error: "no-recipient" };

  try {
    const resend = new Resend(key);
    const from = process.env.RESEND_FROM || "BORROW <onboarding@resend.dev>";
    const { error } = await resend.emails.send({
      from,
      to: d.to,
      subject: `Your BORROW rental receipt — order #${d.transactionId}`,
      html: receiptHtml(d),
    });
    if (error) return { sent: false, error: String(error) };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
