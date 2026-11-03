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
  extraFeeTotal?: number;
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

/** Base URL of the customer shop (for self-service links in emails). */
const SHOP_URL = (
  process.env.SHOP_URL ||
  PORTAL_URL.replace(/\/portal\/?$/, "") ||
  "https://borrowfayetteville.com"
).replace(/\/$/, "");

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
            ${money(l.rental_price)}
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
      ${d.extraFeeTotal ? `<tr><td style="padding:4px 0;">Extended rental (extra days)</td><td style="padding:4px 0;text-align:right;">${money(d.extraFeeTotal)}</td></tr>` : ""}
      ${d.creditApplied ? `<tr><td style="padding:4px 0;">Store credit</td><td style="padding:4px 0;text-align:right;">−${money(d.creditApplied)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #1a1a1a;">Total</td>
          <td style="padding:8px 0;text-align:right;font-weight:bold;border-top:2px solid #1a1a1a;">${money(d.total)}</td></tr>
    </table>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#f3efe8;padding:10px 12px;border-radius:8px;">
      <strong>Cleaning &amp; Care Fee already included.</strong> Every rental price
      already covers professional cleaning, so there's nothing extra to pay.
      <strong>Please don't clean the item yourself</strong> — return it as-is and
      we take care of all cleaning.
    </p>
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
      Questions? DM us <a href="https://instagram.com/borrowfayetteville" style="color:#999;">@borrowfayetteville</a> on Instagram — this inbox isn't monitored.
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
        Total: <strong>${money(d.total)}</strong> — Cleaning &amp; Care Fee already included.
      </p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;">
        Please don't clean the piece yourself — return it as-is and we take care
        of all cleaning.
      </p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">We'll email you a reminder before pickup. See you soon!</p>
    `)
  );
}

export interface DueDateExtensionData {
  to: string;
  firstName: string;
  pieces: string[]; // display names of the affected pieces
}

/**
 * Friendly "your return date moved later, on us" note for a store closure.
 * Deliberately does NOT use BRAND_WRAP because its footer contains an em dash,
 * and this message must be entirely em-dash-free.
 */
export async function sendDueDateExtension(d: DueDateExtensionData) {
  const first = (d.firstName || "there").trim() || "there";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = d.pieces
    .map((p) => `<li style="margin:2px 0;">${esc(p)}</li>`)
    .join("");
  const plural = d.pieces.length > 1 ? "pieces" : "piece";
  const html = `
  <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-style:italic;font-size:32px;margin:0 0 4px;">BORROW</h1>
    <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">A little extra time</p>
    <p style="font-size:16px;">Hi ${esc(first)},</p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">
      Happy news. We are closed August 14, 15, and 16, so we are moving your return date to <strong>Monday, August 17</strong>. That is a few extra days with your ${plural}, on us. No extra charge and no late fee.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;margin-bottom:4px;">Here is what this affects:</p>
    <ul style="font-family:Helvetica,Arial,sans-serif;font-size:15px;margin-top:0;">${list}</ul>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">
      Everything above is now due back Monday, August 17. There is nothing you need to do on your end. Enjoy the extra days, and thank you for renting with BORROW.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">xo,<br/>BORROW Fayetteville</p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">
      Questions? DM us <a href="https://instagram.com/borrowfayetteville" style="color:#999;">@borrowfayetteville</a> on Instagram. This inbox is not monitored.
    </p>
  </div>`;
  return sendEmail(d.to, "A few extra days with your BORROW rental", html);
}

export interface PieceCancellationData {
  to: string;
  customerName: string;
  cancelledBrand: string;
  refundAmount: number;
  remaining: { brand: string; size?: string | null }[];
  pickupLabel: string;
  returnLabel: string;
}

/**
 * Tells a customer one piece was removed from their multi-piece reservation and
 * refunded, and re-states the rest of the order (pieces + pickup/return dates)
 * so they have an up-to-date confirmation.
 */
export async function sendPieceCancellationUpdate(d: PieceCancellationData) {
  const first = d.customerName.split(" ")[0] || "there";
  const rows = d.remaining
    .map(
      (p) =>
        `<li style="margin:2px 0;"><strong>${p.brand}</strong>${
          p.size ? ` <span style="color:#888;">· ${p.size}</span>` : ""
        }</li>`
    )
    .join("");
  const refundLine =
    d.refundAmount > 0
      ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">We&rsquo;ve refunded <strong>${money(
          d.refundAmount
        )}</strong> for that piece back to your card.</p>`
      : "";
  return sendEmail(
    d.to,
    "An update to your BORROW reservation",
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Reservation update</p>
      <p style="font-size:16px;">Hi ${first}, we&rsquo;ve removed the <strong>${d.cancelledBrand}</strong> from your reservation, as requested.</p>
      ${refundLine}
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;margin-bottom:4px;">Here&rsquo;s your updated reservation:</p>
      <ul style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;">${rows}</ul>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">Pickup <strong>${d.pickupLabel}</strong>, back by <strong>${d.returnLabel}</strong>. Everything else is unchanged — see you soon!</p>
    `)
  );
}

export interface OrderCancellationData {
  to: string;
  customerName: string;
  pieces: string[];
  refundAmount: number;
}

/**
 * Confirms a customer's whole reservation was cancelled (and refunded, when a
 * refund applied). Lists the pieces that were on it.
 */
export async function sendOrderCancellation(d: OrderCancellationData) {
  const first = d.customerName.split(" ")[0] || "there";
  const plural = d.pieces.length > 1 ? "pieces" : "piece";
  const rows = d.pieces
    .map((p) => `<li style="margin:2px 0;"><strong>${p}</strong></li>`)
    .join("");
  const refundLine =
    d.refundAmount > 0
      ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">We&rsquo;ve refunded <strong>${money(
          d.refundAmount
        )}</strong> back to your card (the rental price; tax is non-refundable). It may take a few business days to appear.</p>`
      : "";
  return sendEmail(
    d.to,
    "Your BORROW reservation was cancelled",
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Reservation cancelled</p>
      <p style="font-size:16px;">Hi ${first}, your reservation has been cancelled, as requested. It included ${
        d.pieces.length > 1 ? "these" : "this"
      } ${plural}:</p>
      <ul style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;">${rows}</ul>
      ${refundLine}
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">Hope to style you another time — just book again whenever you&rsquo;re ready.</p>
    `)
  );
}

export interface ConsignorCancelData {
  to: string;
  consignorName: string;
  brand: string;
}

/**
 * Tells a consignor a rental of their piece was cancelled — used only when they
 * were already told it rented, so the earlier "your piece rented" note isn't
 * left standing. The piece is back available.
 */
export async function sendConsignorRentalCancelled(d: ConsignorCancelData) {
  const first = d.consignorName.split(" ")[0] || "there";
  return sendEmail(
    d.to,
    `Update: the rental of your ${d.brand} was cancelled`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Rental update</p>
      <p style="font-size:16px;">Hi ${first}, a quick update — the rental of your <strong>${d.brand}</strong> was cancelled, so it&rsquo;s back available for the next renter.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">Nothing you need to do. We&rsquo;ll let you know as soon as it rents again.</p>
    `)
  );
}

export interface ClosureReturnData {
  to: string;
  customerName: string;
  pieces: string[];
  closedLabel: string; // friendly closed date, e.g. "Saturday, September 19"
  returnLabel: string; // friendly new return date, e.g. "Tuesday, September 22"
  reason?: string; // optional why, e.g. "the home game" → "closed that day for the home game"
}

/**
 * Heads-up that the studio is closed on a customer's return day, so their piece
 * is now due back the next open day instead — with no late charge for the closed
 * days in between.
 */
export async function sendClosureReturnNotice(d: ClosureReturnData) {
  const first = d.customerName.split(" ")[0] || "there";
  const plural = d.pieces.length > 1 ? "pieces" : "piece";
  const rows = d.pieces
    .map((p) => `<li style="margin:2px 0;"><strong>${p}</strong></li>`)
    .join("");
  const reasonText = d.reason ? ` for ${d.reason}` : "";
  return sendEmail(
    d.to,
    `We're closed ${d.closedLabel} — your return moves to ${d.returnLabel}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Return update</p>
      <p style="font-size:16px;">Hi ${first}, your ${plural} ${
        d.pieces.length > 1 ? "were" : "was"
      } due back on <strong>${d.closedLabel}</strong>, but we&rsquo;ll be closed that day${reasonText}.</p>
      <ul style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;">${rows}</ul>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">No need to rush — just bring ${
        d.pieces.length > 1 ? "them" : "it"
      } back on <strong>${d.returnLabel}</strong>, the next day we&rsquo;re open. You <strong>won&rsquo;t be charged any late fees</strong> for the closed days, so you&rsquo;re all set.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">Thank you so much — see you then!</p>
    `)
  );
}

export interface RentalDatesUpdateData {
  to: string;
  firstName: string;
  pieces: string[];
  pickupLabel: string; // friendly, e.g. "Friday, August 7"
  returnLabel: string; // friendly, e.g. "Monday, August 17"
}

/**
 * "Your rental dates changed" note (pickup and/or return moved). Entirely
 * em-dash-free, so it does not use BRAND_WRAP (whose footer has an em dash).
 */
export async function sendRentalDatesUpdate(d: RentalDatesUpdateData) {
  const first = (d.firstName || "there").trim() || "there";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = d.pieces.map((p) => `<li style="margin:2px 0;">${esc(p)}</li>`).join("");
  const plural = d.pieces.length > 1 ? "pieces" : "piece";
  const html = `
  <div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-style:italic;font-size:32px;margin:0 0 4px;">BORROW</h1>
    <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Rental update</p>
    <p style="font-size:16px;">Hi ${esc(first)},</p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">
      Quick update on your rental. Your pickup is now <strong>${esc(d.pickupLabel)}</strong>, and your return date is <strong>${esc(d.returnLabel)}</strong>. Same ${plural}, same price, no extra charge.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;margin-bottom:4px;">Here is what this covers:</p>
    <ul style="font-family:Helvetica,Arial,sans-serif;font-size:15px;margin-top:0;">${list}</ul>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">
      There is nothing you need to do on your end. If these days do not work, just reply and we will sort it out. See you soon, and thank you for renting with BORROW.
    </p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">xo,<br/>BORROW Fayetteville</p>
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#999;margin-top:24px;">
      Questions? DM us <a href="https://instagram.com/borrowfayetteville" style="color:#999;">@borrowfayetteville</a> on Instagram. This inbox is not monitored.
    </p>
  </div>`;
  return sendEmail(d.to, "An update to your BORROW rental", html);
}

export interface ReminderEmailData {
  to: string;
  customerName: string;
  brand: string;
  date: string; // friendly start or due date
  hours?: string; // optional open-hours note, e.g. "12–4pm"
}

/** Reminder the day before pickup. */
export async function sendPickupReminder(d: ReminderEmailData) {
  const first = d.customerName.split(" ")[0] || "there";
  const hoursLine = d.hours
    ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">We&rsquo;re open <strong>${d.hours}</strong> that day — come by to pick it up.</p>`
    : "";
  return sendEmail(
    d.to,
    `Pickup reminder — ${d.brand}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Pickup reminder</p>
      <p style="font-size:16px;">Hi ${first}, your <strong>${d.brand}</strong> is ready for pickup on <strong>${d.date}</strong>.</p>
      ${hoursLine}
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">Questions? DM us <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a> on Instagram.</p>
    `)
  );
}

/** Reminder near the return due date. */
export async function sendDueReminder(d: ReminderEmailData) {
  const first = d.customerName.split(" ")[0] || "there";
  const hoursLine = d.hours
    ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">We&rsquo;re open <strong>${d.hours}</strong> that day for returns.</p>`
    : "";
  return sendEmail(
    d.to,
    `Return reminder — ${d.brand} is due ${d.date}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Return reminder</p>
      <p style="font-size:16px;">Hi ${first}, a friendly reminder that your <strong>${d.brand}</strong> is due back on <strong>${d.date}</strong>.</p>
      ${hoursLine}
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">Late returns are charged $15 per day, so please get it back on time.</p>
    `)
  );
}

export interface OverdueReminderData {
  to: string;
  customerName: string;
  items: { brand: string; due: string; daysOverdue: number }[];
}

/**
 * Overdue-return nudge: a piece (or several) is already past its due date and
 * accruing the $15-per-item-per-day late fee. Lists every overdue piece and
 * makes the running cost concrete so the renter brings them back promptly.
 */
export async function sendOverdueReminder(d: OverdueReminderData) {
  const first = d.customerName.split(" ")[0] || "there";
  const n = d.items.length;
  const perDay = n * 15;
  const rows = d.items
    .map(
      (it) =>
        `<li><strong>${it.brand}</strong> — due ${it.due}, now ${it.daysOverdue} ${
          it.daysOverdue === 1 ? "day" : "days"
        } overdue</li>`
    )
    .join("");
  const costLine =
    n > 1
      ? `Late returns are charged <strong>$15 per item, per day</strong> — with ${n} pieces out, that&rsquo;s <strong>$${perDay} a day</strong> adding up while they&rsquo;re late.`
      : `Late returns are charged <strong>$15 per item, per day</strong>, so the fee keeps adding up each day it&rsquo;s late.`;
  return sendEmail(
    d.to,
    n > 1
      ? "Your BORROW dresses are overdue — please bring them back"
      : "Your BORROW rental is overdue — please bring it back",
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Return reminder</p>
      <p style="font-size:16px;">Hi ${first}, just a friendly heads-up that ${
        n > 1 ? "these pieces are" : "this piece is"
      } past ${n > 1 ? "their" : "its"} return date:</p>
      <ul style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#1a1a1a;">${rows}</ul>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">${costLine} Please bring ${
        n > 1 ? "them" : "it"
      } back to the studio as soon as you can so the fees stop.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">Thank you so much — we appreciate you!</p>
    `)
  );
}

export interface PayoutNoticeData {
  to: string;
  consignorName: string;
  amount: number;
  method: string | null;
}

export interface ConsignorWelcomeData {
  to: string;
  consignorName: string;
  onboardingUrl: string | null;
  rate?: number; // consignor % they'll earn
}

/**
 * Welcomes a newly-added consignor with their personal Stripe onboarding link
 * so they can set up how they get paid. Exact copy provided by Borrow.
 */
export async function sendConsignorWelcome(d: ConsignorWelcomeData) {
  const first = d.consignorName.split(" ")[0] || "there";
  const rate = d.rate ?? 20;
  const link = d.onboardingUrl || PORTAL_URL;
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  return sendEmail(
    d.to,
    "Welcome to Borrow — one quick step to get paid",
    BRAND_WRAP(`
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">Welcome to the Borrow consignor family! We're so excited to have your pieces in the closet.</p>
      <p style="${p}">To pay you your earnings, we use Stripe (a secure payment service). Tap the link below to set up your payout info — it takes about 2–5 minutes on your phone:</p>
      <p style="margin:22px 0;"><a href="${link}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Set up my payout info</a></p>
      <p style="${p}">A few things so it goes smoothly:</p>
      <ul style="${p}padding-left:20px;">
        <li style="margin-bottom:8px;">Stripe calls everyone a "business" on the form — ignore that, it's just their standard wording. You're not signing up for anything or paying anything; this is only so we can send you money and handle taxes correctly.</li>
        <li style="margin-bottom:8px;">You'll need your legal name (as it appears on your ID), date of birth, address, the last 4 digits of your SSN, and where to send your money (a bank account or debit card — debit is easiest).</li>
        <li style="margin-bottom:8px;">When it asks for "your website," you don't need one. Click "Don't have a website? Add product description instead" right below that field, and just write something like: "I consign clothing items to Borrow, a dress rental boutique, and receive a share of the rental income."</li>
      </ul>
      <p style="${p}">That's it! You'll earn ${rate}% every time one of your pieces rents, and once the piece is returned your payout arrives in your bank within 3–5 business days.</p>
      <p style="${p}">Questions? DM us <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a> on Instagram.</p>
      <p style="${p}">xo,<br/>Borrow</p>
    `)
  );
}

export interface DropoffConfirmationData {
  to: string;
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  itemCount: number;
  manageToken?: string | null; // lets them cancel/reschedule from the email
  rate?: number; // consignor % they'll earn (promised at booking time)
}

/** Confirms a consignor's drop-off appointment (date, time, count + guidelines). */
export async function sendDropoffConfirmation(d: DropoffConfirmationData) {
  const rate = d.rate ?? 60;
  const first = d.name.split(" ")[0] || "there";
  const prettyDate = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const [h, m] = d.time.split(":").map(Number);
  const prettyTime = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const manageUrl = d.manageToken
    ? `${SHOP_URL}/dropoff/manage?token=${encodeURIComponent(d.manageToken)}`
    : null;
  return sendEmail(
    d.to,
    "Your Borrow drop-off appointment is booked",
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Drop-off booked</p>
      <p style="${p}">Hi ${first}, you're all set to bring in your pieces:</p>
      <p style="${p}font-size:18px;"><strong>${prettyDate} at ${prettyTime}</strong><br/>${d.itemCount} item${d.itemCount === 1 ? "" : "s"}</p>
      ${
        manageUrl
          ? `<p style="margin:20px 0;"><a href="${manageUrl}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Reschedule or cancel</a></p>
      <p style="${p}font-size:13px;color:#888;">Plans change, and you can move or cancel this appointment anytime with the button above. No need to message us.</p>`
          : ""
      }
      <p style="${p}">A few reminders so it goes smoothly:</p>
      <p style="${p}">Borrow is a curated closet, so we're selective about what we carry — bring your best, current, on-trend pieces in excellent condition. All items should be clean and ready to rent; we're unable to accept anything stained, damaged, or in need of cleaning.</p>
      <p style="${p}">We may accept some, all, or none of what you bring in — that's what keeps the closet special.</p>
      <p style="${p}">Accepted pieces are consigned to you: you earn ${rate}% every time yours rents, and you can retrieve any piece at any time, as long as it isn't currently rented out or reserved.</p>
      <p style="${p}">See you then! Questions? DM us <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a> on Instagram.</p>
      <p style="${p}">xo,<br/>Borrow</p>
    `)
  );
}

/** Notifies a consignor that BORROW has sent them a payout. */
export interface DropoffRescheduleData {
  to: string;
  name: string;
  date: string; // YYYY-MM-DD (the closed day the appointment fell on)
  time: string; // HH:MM (24h)
  manageToken?: string | null;
}

/** Asks a customer to reschedule a drop-off that fell on a day we're closed. */
export async function sendDropoffRescheduleRequest(d: DropoffRescheduleData) {
  const first = d.name.split(" ")[0] || "there";
  const prettyDate = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const [h, m] = d.time.split(":").map(Number);
  const prettyTime = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const url = d.manageToken
    ? `${SHOP_URL}/dropoff/manage?token=${encodeURIComponent(d.manageToken)}`
    : `${SHOP_URL}/dropoff`;
  return sendEmail(
    d.to,
    "Please reschedule your Borrow drop-off",
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Drop-off needs rescheduling</p>
      <p style="${p}">Hi ${first}, unfortunately we&rsquo;re closed on <strong>${prettyDate}</strong>, so your drop-off appointment that day at <strong>${prettyTime}</strong> can&rsquo;t happen.</p>
      <p style="${p}">We tried reaching you by text three times without luck, so we wanted to email too. Could you grab a new time? It only takes a minute:</p>
      <p style="margin:20px 0;"><a href="${url}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Pick a new drop-off time</a></p>
      <p style="${p}">So sorry for the mix-up, and thank you! We can&rsquo;t wait to see your pieces.</p>
      <p style="${p}">&mdash; Borrow</p>
    `)
  );
}

/**
 * Owner is away and must move a booked drop-off. Urgent, warm note pointing the
 * customer to DM Instagram for a new time, and noting the $10 apology credit.
 */
export interface DropoffClosureData {
  to: string;
  name: string;
  date: string; // YYYY-MM-DD of the appointment being moved
  time: string; // HH:MM (24h)
}

export async function sendDropoffClosureReschedule(d: DropoffClosureData) {
  const first = d.name.split(" ")[0] || "there";
  const dayLong = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const shortDate = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const [h, m] = d.time.split(":").map(Number);
  const prettyTime = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  return sendEmail(
    d.to,
    "⚠️ Action needed: your Borrow drop-off has to be moved",
    BRAND_WRAP(`
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">I&rsquo;m so sorry for the short notice. I&rsquo;m going to be out of town on <strong>${dayLong}</strong>, and I&rsquo;m the only one who can take drop-off appointments, so I unfortunately have to move yours (it was booked for ${shortDate} at ${prettyTime})!</p>
      <p style="${p}">Please DM us on Instagram <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a> as soon as you can so we can find you a new time. As a thank you for your patience, I&rsquo;ve added <strong>$10 store credit</strong> to your account to use on your next rental.!!!</p>
      <p style="${p}">So sorry again for the hassle, and I can&rsquo;t wait to see what you&rsquo;re bringing in!</p>
      <p style="${p}">xo,<br/>Borrow Fayetteville</p>
    `)
  );
}

/**
 * Emails a renter a secure Stripe link to pay an uncollected charge (e.g. a
 * replacement value the card-on-file declined off-session). `reason` is the
 * one-clause explanation shown mid-sentence (e.g. "the zipper was damaged beyond
 * repair").
 */
export interface ChargeLinkData {
  to: string;
  name: string;
  brand: string;
  amount: number;
  url: string;
  reason: string;
}

export async function sendReplacementPaymentLink(d: ChargeLinkData) {
  const first = d.name.split(" ")[0] || "there";
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const amt = `$${Number(d.amount) % 1 === 0 ? Number(d.amount).toFixed(0) : Number(d.amount).toFixed(2)}`;
  return sendEmail(
    d.to,
    `Your Borrow rental — ${d.brand}`,
    BRAND_WRAP(`
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">Thank you so much for renting the ${d.brand}! Unfortunately, when it came back ${d.reason}, so the piece is no longer wearable for future rentals. Per the rental agreement, that means the piece&rsquo;s replacement value applies &mdash; <strong>${amt}</strong>.</p>
      <p style="${p}">We tried to process it on the card we have on file, but it didn&rsquo;t go through (for a charge this size, your bank usually needs you to approve it directly). You can take care of it securely here:</p>
      <p style="margin:22px 0;"><a href="${d.url}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:13px 26px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Pay ${amt} replacement securely</a></p>
      <p style="${p}">That&rsquo;s the only step &mdash; once it goes through, you&rsquo;re all set. If you have any questions or think something&rsquo;s off, just reply to this email or DM us <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a> and we&rsquo;ll gladly help.</p>
      <p style="${p}">Thank you!</p>
      <p style="${p}">xo,<br/>Borrow Fayetteville</p>
    `)
  );
}

export interface ConsignorLossData {
  to: string;
  consignorName: string;
  itemBrand: string;
  amount: number;
}

/** Heads-up to a consignor that a piece was damaged beyond repair / not returned
 *  and their agreed replacement value is being paid out. */
export async function sendConsignorLossNotice(d: ConsignorLossData) {
  const first = d.consignorName.split(" ")[0] || "there";
  return sendEmail(
    d.to,
    `Update on your ${d.itemBrand}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Consigned piece update</p>
      <p style="font-size:16px;">Hi ${first}, we wanted to let you know your <strong>${d.itemBrand}</strong> was damaged beyond repair during a rental and won't be coming back.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">
        Per your consignor agreement, we're covering you for its full agreed replacement value of <strong>${money(d.amount)}</strong>. That amount is on its way to your account and will show in your consignor portal, whether or not we recover it from the renter.
      </p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">We're sorry to see this one go. Thank you for consigning with BORROW.</p>
    `)
  );
}

export interface ConsignorNoShowData {
  to: string;
  consignorName: string;
  itemBrand: string;
}

/** Heads-up to a consignor that a customer reserved their piece but never picked
 *  it up by the return date — so the rental didn't happen and no payout is coming. */
export async function sendConsignorNoShowNotice(d: ConsignorNoShowData) {
  const first = d.consignorName.split(" ")[0] || "there";
  return sendEmail(
    d.to,
    `Update on your ${d.itemBrand}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Consigned piece update</p>
      <p style="font-size:16px;">Hi ${first}, a customer had reserved your <strong>${d.itemBrand}</strong>, but they never came in to pick it up by the return date.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">Because the rental never actually happened, there's no payout for this one — any payment that was processing for it has stopped. Your piece was never worn and is going straight back onto the rack, ready to rent again.</p>
      <p style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">Nothing you need to do. Thank you for consigning with BORROW.</p>
    `)
  );
}

export interface OwnerNoShowData {
  itemBrand: string;
  itemId: string;
  customerName: string | null;
  dueDate: string; // human-readable, e.g. "August 17, 2026"
}

/** Alerts the studio owner that a reserved piece was never picked up by its
 *  return date, so it's clear to put back on the rack (Cancel to release). */
export async function sendOwnerNoShowAlert(d: OwnerNoShowData) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return { sent: false, error: "no-admin-email" };
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const studio = "https://admin.borrowfayetteville.com/calendar";
  return sendEmail(
    to,
    `Never picked up — ${d.itemBrand} is clear for the rack`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 20px;">Reservation never picked up</p>
      <p style="${p}"><strong>${d.itemBrand}</strong> (${d.itemId})${d.customerName ? `, reserved by <strong>${d.customerName}</strong>,` : ""} was never picked up and was due back <strong>${d.dueDate}</strong>.</p>
      <p style="${p}">They keep their payment (no refund), and the consignor has been told there's no payout. The piece is clear to put back on the rack — open the calendar and Cancel the reservation to release it.</p>
      <p style="margin:20px 0;"><a href="${studio}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Open the calendar</a></p>
    `)
  );
}

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

export interface RecoveryNoticeData {
  to: string;
  consignorName: string;
  brand: string;
  amount: number;
}

/** Heads-up that a payout went out in error and will be netted from future ones. */
export async function sendConsignorRecoveryNotice(d: RecoveryNoticeData) {
  const first = d.consignorName.split(" ")[0] || "there";
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  return sendEmail(
    d.to,
    "A small correction on your BORROW payout",
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Payout correction</p>
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">Quick note from our end: a rental of your <strong>${d.brand}</strong> was cancelled after a payout of <strong>${money(d.amount)}</strong> had already gone out to you, so that amount was sent by mistake.</p>
      <p style="${p}"><strong>Nothing you need to do.</strong> We'll simply apply that ${money(d.amount)} against your next payout(s), so it evens out automatically over your upcoming rentals.</p>
      <p style="${p}">Sorry for the mix-up, and thank you for consigning with BORROW.</p>
      <p style="${p}">xo,<br/>BORROW Fayetteville</p>
    `)
  );
}

export interface PickupNoticeData {
  to: string;
  consignorName: string;
  itemName: string;
  deadlineDate: string; // human-readable, e.g. "August 15, 2026"
}

/** 30-day pickup notice for an underperforming piece (owner-approved). */
export async function sendPickupNotice(d: PickupNoticeData) {
  const first = d.consignorName.split(" ")[0] || "there";
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  return sendEmail(
    d.to,
    `Time to pick up ${d.itemName} from Borrow`,
    BRAND_WRAP(`
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">${d.itemName} hasn't found its renter recently, and since our closet space is limited, we're not able to keep underperforming pieces in rotation indefinitely.</p>
      <p style="${p}">You have 30 days from this email to come pick it up. Just stop by the studio anytime we're open, or reach out to arrange a time.</p>
      <p style="${p}">If we don't hear from you by <strong>${d.deadlineDate}</strong>, we'll move it to storage in the back, and it will no longer be available to rent.</p>
      <p style="${p}">Questions? Just reply to this email or DM us <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a>.</p>
      <p style="${p}">xo,<br/>Borrow</p>
    `)
  );
}

export interface PickupNoticeBatchData {
  to: string;
  consignorName: string;
  itemNames: string[];
  deadlineDate: string; // human-readable, e.g. "August 15, 2026"
}

/**
 * 30-day pickup notice covering SEVERAL of a consignor's underperforming pieces
 * in one email (owner-approved). Falls back to the single-piece notice when only
 * one piece is given.
 */
export async function sendPickupNoticeBatch(d: PickupNoticeBatchData) {
  if (d.itemNames.length <= 1) {
    return sendPickupNotice({
      to: d.to,
      consignorName: d.consignorName,
      itemName: d.itemNames[0] || "your piece",
      deadlineDate: d.deadlineDate,
    });
  }
  const first = d.consignorName.split(" ")[0] || "there";
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const count = d.itemNames.length;
  const list = d.itemNames
    .map((n) => `<li style="${p}margin:0;">${n}</li>`)
    .join("");
  return sendEmail(
    d.to,
    `Time to pick up ${count} pieces from Borrow`,
    BRAND_WRAP(`
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">A few of your pieces haven't found their renters recently, and since our closet space is limited, we're not able to keep underperforming pieces in rotation indefinitely:</p>
      <ul style="${p}padding-left:20px;">${list}</ul>
      <p style="${p}">You have 30 days from this email to come pick them up. Just stop by the studio anytime we're open, or reach out to arrange a time.</p>
      <p style="${p}">If we don't hear from you by <strong>${d.deadlineDate}</strong>, we'll move them to storage in the back, and they'll no longer be available to rent.</p>
      <p style="${p}">Questions? Just reply to this email or DM us <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a>.</p>
      <p style="${p}">xo,<br/>Borrow</p>
    `)
  );
}

/** Shorter reminder sent 5 days before the storage pickup deadline. */
export async function sendStoragePickupReminder(d: PickupNoticeData) {
  const first = d.consignorName.split(" ")[0] || "there";
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  return sendEmail(
    d.to,
    `Quick reminder — pick up ${d.itemName} from Borrow`,
    BRAND_WRAP(`
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">Quick reminder — ${d.itemName} needs to be picked up from Borrow by <strong>${d.deadlineDate}</strong>, or it will move to storage and stop being rented.</p>
      <p style="${p}">Stop by anytime we're open, or reply here to arrange a time.</p>
      <p style="${p}">xo,<br/>Borrow</p>
    `)
  );
}

export interface DisputeAlertData {
  consignorName: string;
  itemBrand: string;
  originalValue: number;
  suggestedValue: number;
  note?: string | null;
}

export interface RetrievalRequestAlert {
  consignorName: string;
  itemBrand: string;
  consignorId: number;
  note?: string | null;
}

export interface ItemPickupRequestData {
  to: string;
  consignorName: string;
  itemBrand: string;
}

/** Asks a consignor to collect a piece that hasn't been renting. */
export async function sendItemPickupRequest(d: ItemPickupRequestData) {
  const first = d.consignorName.split(" ")[0] || "there";
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  return sendEmail(
    d.to,
    `Your piece is ready to come home — ${d.itemBrand}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 24px;">Time to collect your piece</p>
      <p style="${p}">Hi ${first}, thank you so much for consigning with BORROW.</p>
      <p style="${p}">Your <strong>${d.itemBrand}</strong> hasn't been renting the way we'd hoped, so rather than keep it sitting on the rack, we'd love for you to come pick it up. It's clean, cared for, and ready whenever you are.</p>
      <p style="${p}">Just reply here or DM us <a href="https://instagram.com/borrowfayetteville">@borrowfayetteville</a> to set up a time that works. Thank you for being part of the closet.</p>
      <p style="${p}">xo,<br/>Borrow</p>
    `)
  );
}

/** Alerts the studio owner that a consignor asked for one of their pieces back. */
export async function sendRetrievalRequest(d: RetrievalRequestAlert) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return { sent: false, error: "no-admin-email" };
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const studio = `https://admin.borrowfayetteville.com/consignors?open=${d.consignorId}`;
  return sendEmail(
    to,
    `Retrieval request — ${d.consignorName} wants ${d.itemBrand} back`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 20px;">Piece retrieval requested</p>
      <p style="${p}"><strong>${d.consignorName}</strong> would like <strong>${d.itemBrand}</strong> back.</p>
      <p style="${p}">The piece isn't rented or reserved, so it's clear to return. Reach out to coordinate pickup.</p>
      ${d.note ? `<p style="${p}">Their note: "${d.note}"</p>` : ""}
      <p style="margin:20px 0;"><a href="${studio}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Open the consignor</a></p>
    `)
  );
}

/** Alerts the studio owner that a consignor disputed a replacement value. */
export async function sendDisputeAlert(d: DisputeAlertData) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return { sent: false, error: "no-admin-email" };
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const studio = "https://admin.borrowfayetteville.com/consignors";
  return sendEmail(
    to,
    `Disputed value — ${d.consignorName} suggests ${money(d.suggestedValue)}`,
    BRAND_WRAP(`
      <p style="text-transform:uppercase;letter-spacing:3px;font-size:11px;color:#888;margin:0 0 20px;">Replacement value disputed</p>
      <p style="${p}"><strong>${d.consignorName}</strong> disputed the replacement value on <strong>${d.itemBrand}</strong>.</p>
      <p style="${p}">Your value: <strong>${money(d.originalValue)}</strong><br/>Their suggestion: <strong>${money(d.suggestedValue)}</strong></p>
      ${d.note ? `<p style="${p}">Their note: "${d.note}"</p>` : ""}
      <p style="${p}">Open the consignor in the studio to approve their value or keep yours.</p>
      <p style="margin:20px 0;"><a href="${studio}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Review in the studio</a></p>
    `)
  );
}

export interface ApprovalRequestData {
  to: string;
  consignorName: string;
  count: number;
  portalCode?: string | null;
  itemNames?: string[]; // the specific pieces in this batch, listed in the email
}

/** Asks a consignor to review + approve the replacement value on new pieces. */
export async function sendApprovalRequest(d: ApprovalRequestData) {
  const first = d.consignorName.split(" ")[0] || "there";
  const link = d.portalCode
    ? `${PORTAL_URL}?code=${encodeURIComponent(d.portalCode)}`
    : PORTAL_URL;
  const p = "font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const n = d.count;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list =
    d.itemNames && d.itemNames.length
      ? `<ul style="${p}margin:12px 0;padding-left:20px;">${d.itemNames
          .map((nm) => `<li>${esc(nm)}</li>`)
          .join("")}</ul>`
      : "";
  return sendEmail(
    d.to,
    "Please review your items — Borrow",
    BRAND_WRAP(`
      <p style="${p}">Hi ${first},</p>
      <p style="${p}">You have ${n} item${n === 1 ? "" : "s"} ready for your review in your Borrow consignor hub. Please take a look and approve the replacement value we set for each piece.</p>
      ${list}
      <p style="${p}">Nothing is listed for rent until you approve it. If a value doesn't look right, tap "Dispute" and stop by the store so we can sort it out together.</p>
      <p style="margin:22px 0;"><a href="${link}" style="background:#1a1a1a;color:#f7f4ef;text-decoration:none;padding:12px 24px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;">Review my items</a></p>
    `)
  );
}
