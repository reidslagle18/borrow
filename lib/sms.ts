/**
 * SMS sending for the Team feature (Twilio REST — no SDK, just fetch).
 * Gated three ways so it can never fire prematurely:
 *   1. the owner's `sms_enabled` team setting is on, AND
 *   2. Twilio credentials are present in the environment, AND
 *   3. a recipient number is provided.
 * Until a provider + number are configured and the setting is on, every call is
 * a silent no-op — so wiring it into notification points is safe before setup.
 *
 * Env vars (added once the Twilio number is approved):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (e.g. +15015551234)
 */
import { getTeamSettings } from "@/lib/team";

/** Normalize a US number to E.164 (+1XXXXXXXXXX). Returns null if unusable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(raw).trim().startsWith("+")) return `+${digits}`;
  return null;
}

/** True when a provider is configured AND the owner has SMS turned on. */
export async function smsReady(): Promise<boolean> {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER)
    return false;
  const s = await getTeamSettings();
  return !!s.sms_enabled;
}

/** Best-effort single SMS. Never throws. */
export async function sendSMS(to: string | null | undefined, body: string): Promise<{ sent: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { sent: false, error: "sms-not-configured" };
  const toNorm = normalizePhone(to);
  if (!toNorm) return { sent: false, error: "no-recipient" };
  try {
    const s = await getTeamSettings();
    if (!s.sms_enabled) return { sent: false, error: "sms-disabled" };
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toNorm, From: from, Body: body }).toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { sent: false, error: `twilio-${res.status}:${txt.slice(0, 120)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

/** Fan out one message to many numbers, best-effort. Returns count sent. */
export async function sendSMSMany(numbers: (string | null | undefined)[], body: string): Promise<number> {
  let n = 0;
  for (const num of numbers) {
    const r = await sendSMS(num, body);
    if (r.sent) n++;
  }
  return n;
}
