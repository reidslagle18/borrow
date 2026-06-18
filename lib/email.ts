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
  creditApplied?: number;
  startDate: string;
  dueDate: string;
  agreementName: string;
  transactionId: number;
}

function money(n: number): string {
  return `$${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;
}

/** Consignor-facing portal on the customer site (no admin access). */
const PORTAL_URL = process.env.PORTAL_URL || "https://borrow-shop.vercel.app/portal";

export interface ConsignorRentedData {
  to: string;
  consignorName: string;
  brand: string;
  earned: number;
  portalCode: string | null;
}

function consignorRentedHtml(d: ConsignorRentedData): string {
  const link = d.portalCode
    ? `${PORTAL_URL}?code=${encodeURIComponent(d.portalCode)}`
    : PORTAL_URL;
  return `
  <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-style:italic;font-size:32px;margin:0 0 4px;">BORROW</h1>
    <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Your piece just rented</p>
    <p style="font-size:16px;">Congrats${d.consignorName ? `, ${d.consignorName.split(" ")[0]}` : ""}! Your <strong>${d.brand}</strong> has been rented out.</p>
    <p style="font-size:22px;margin:16px 0;">You earned <strong>${money(d.earned)}</strong> on this rental.</p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#444;">
      Head to your consignor portal to claim your earnings and see all your pieces and their status.
    </p>
    <p style="margin:24px 0;">
      <a href="${link}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:15px;">
        View my portal
      </a>
    </p>
    ${
      d.portalCode
        ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#888;">Your access code: <strong style="font-family:monospace;">${d.portalCode}</strong></p>`
        : ""
    }
  </div>`;
}

/**
 * Notifies a consignor that their piece was rented and what they earned.
 * Best-effort: no-ops (returns sent:false) when RESEND_API_KEY isn't set, so
 * checkout/pickup never fail on a missing email config.
 */
export async function sendConsignorRentedEmail(
  d: ConsignorRentedData
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
      subject: `Your ${d.brand} just rented — you earned ${money(d.earned)}`,
      html: consignorRentedHtml(d),
    });
    if (error)
      return {
        sent: false,
        error:
          typeof error === "object" ? JSON.stringify(error) : String(error),
      };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
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
            ${money(l.rental_price)}${l.waiver ? ` + ${money(l.waiver)} cleaning` : ""}
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
      <tr><td style="padding:4px 0;">Cleaning &amp; Care Fee</td><td style="padding:4px 0;text-align:right;">${money(d.waiverTotal)}</td></tr>
      ${d.creditApplied ? `<tr><td style="padding:4px 0;">Store credit</td><td style="padding:4px 0;text-align:right;">−${money(d.creditApplied)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #1a1a1a;">Total</td>
          <td style="padding:8px 0;text-align:right;font-weight:bold;border-top:2px solid #1a1a1a;">${money(d.total)}</td></tr>
    </table>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;">
      Rental period: <strong>${d.startDate}</strong> &rarr; <strong>${d.dueDate}</strong>
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
      subject: `Your BORROW rental receipt`,
      html: receiptHtml(d),
    });
    if (error)
      return {
        sent: false,
        error:
          typeof error === "object" ? JSON.stringify(error) : String(error),
      };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

// --- Booking & rental lifecycle notifications (email, best-effort) ---------

const BRAND_WRAP = (inner: string) => `
  <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-style:italic;font-size:32px;margin:0 0 4px;">BORROW</h1>
    ${inner}
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">
      Questions? Just reply to this email.
    </p>
  </div>`;

async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, error: "email-not-configured" };
  if (!to) return { sent: false, error: "no-recipient" };
  try {
    const resend = new Resend(key);
    const from = process.env.RESEND_FROM || "BORROW <onboarding@resend.dev>";
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error)
      return {
        sent: false,
        error: typeof error === "object" ? JSON.stringify(error) : String(error),
      };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

export interface BookingEmailData {
  to: string;
  customerName: string;
  brand: string;
  startDate: string; // friendly string
  dueDate: string;
  total: number;
}

/** Instant confirmation when a reservation is made. */
export async function sendBookingConfirmation(d: BookingEmailData) {
  const first = d.customerName.split(" ")[0] || "there";
  return sendEmail(
    d.to,
    `You're booked — ${d.brand}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Reservation confirmed</p>
      <p style="font-size:16px;">Hi ${first}, your <strong>${d.brand}</strong> is reserved.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">
        Rental window: <strong>${d.startDate} – ${d.dueDate}</strong><br/>
        Total at pickup: <strong>${money(d.total)}</strong> (includes the Cleaning &amp; Care Fee)
      </p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">We'll email you a reminder before pickup. See you soon!</p>
    `)
  );
}

export interface ReminderEmailData {
  to: string;
  customerName: string;
  brand: string;
  date: string; // friendly start or due date
}

/** Reminder the day before pickup. */
export async function sendPickupReminder(d: ReminderEmailData) {
  const first = d.customerName.split(" ")[0] || "there";
  return sendEmail(
    d.to,
    `Pickup reminder — ${d.brand}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Pickup reminder</p>
      <p style="font-size:16px;">Hi ${first}, your <strong>${d.brand}</strong> is ready for pickup on <strong>${d.date}</strong>.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">Reply to this email to arrange a time.</p>
    `)
  );
}

/** Reminder near the return due date. */
export async function sendDueReminder(d: ReminderEmailData) {
  const first = d.customerName.split(" ")[0] || "there";
  return sendEmail(
    d.to,
    `Return reminder — ${d.brand} is due ${d.date}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Return reminder</p>
      <p style="font-size:16px;">Hi ${first}, a friendly reminder that your <strong>${d.brand}</strong> is due back on <strong>${d.date}</strong>.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">Late returns are charged $15 per day, so please get it back on time.</p>
    `)
  );
}

export interface PayoutNoticeData {
  to: string;
  consignorName: string;
  amount: number;
  method: string | null;
}

/** Notifies a consignor that BORROW has sent them a payout. */
export async function sendPayoutNotice(d: PayoutNoticeData) {
  const first = d.consignorName.split(" ")[0] || "there";
  return sendEmail(
    d.to,
    `You've been paid ${money(d.amount)} by BORROW`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Payout sent</p>
      <p style="font-size:16px;">Hi ${first}, BORROW just sent you <strong>${money(d.amount)}</strong>${d.method ? ` via ${d.method}` : ""}.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">You can see your full earnings and payout history anytime in your consignor portal.</p>
    `)
  );
}
