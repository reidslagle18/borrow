import crypto from "node:crypto";

/**
 * Minimal Google Calendar writer for drop-off appointments.
 *
 * Uses a Google service account (no interactive OAuth, no extra npm deps): we
 * sign a JWT with the service account's private key, exchange it for an access
 * token, and call the Calendar REST API. Everything is best-effort and a no-op
 * unless BOTH env vars are set, so the app runs fine before it's connected:
 *
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — the full contents of the downloaded key file
 *                                  (raw JSON, or base64 of it)
 *   GOOGLE_CALENDAR_ID           — the "borrow" calendar's Calendar ID
 *
 * The service account's email must be given "Make changes to events" access to
 * that calendar (share it in Google Calendar settings).
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TIME_ZONE = "America/Chicago";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  let text = raw.trim();
  // Allow either raw JSON or a base64-encoded blob.
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const j = JSON.parse(text);
    if (j.client_email && j.private_key) {
      return { client_email: j.client_email, private_key: j.private_key };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function gcalEnabled(): boolean {
  return !!loadServiceAccount() && !!process.env.GOOGLE_CALENDAR_ID;
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64url");

// Cache the access token in module scope (tokens live ~1h).
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claim}`;
  let signature: string;
  try {
    signature = crypto
      .createSign("RSA-SHA256")
      .update(signingInput)
      .sign(sa.private_key, "base64url");
  } catch {
    return null;
  }
  const assertion = `${signingInput}.${signature}`;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
    return data.access_token;
  } catch {
    return null;
  }
}

/** "HH:MM" + minutes → "HH:MM" (same day; drop-off slots never cross midnight). */
function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h || 0) * 60 + (m || 0) + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export interface DropoffEvent {
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  itemCount: number;
  durationMin: number;
  phone?: string | null;
  email?: string | null;
}

function eventBody(e: DropoffEvent) {
  const items = `${e.itemCount} ${e.itemCount === 1 ? "item" : "items"}`;
  const lines = [
    "Consignor drop-off",
    `Name: ${e.name}`,
    `Items: ${e.itemCount}`,
    e.phone ? `Phone: ${e.phone}` : null,
    e.email ? `Email: ${e.email}` : null,
    "Booked via borrowfayetteville.com",
  ].filter(Boolean);
  return {
    summary: `Drop-off: ${e.name} (${items})`,
    description: lines.join("\n"),
    start: { dateTime: `${e.date}T${e.time}:00`, timeZone: TIME_ZONE },
    end: {
      dateTime: `${e.date}T${addMinutes(e.time, e.durationMin)}:00`,
      timeZone: TIME_ZONE,
    },
  };
}

async function authedFetch(
  path: string,
  init: RequestInit
): Promise<Response | null> {
  const sa = loadServiceAccount();
  if (!sa) return null;
  const token = await getAccessToken(sa);
  if (!token) return null;
  try {
    return await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  } catch {
    return null;
  }
}

/** Create the calendar event. Returns the Google event id, or null if disabled/failed. */
export async function createDropoffEvent(e: DropoffEvent): Promise<string | null> {
  if (!gcalEnabled()) return null;
  const cal = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID as string);
  const res = await authedFetch(`/calendars/${cal}/events`, {
    method: "POST",
    body: JSON.stringify(eventBody(e)),
  });
  if (!res || !res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

/** Move an existing event to a new date/time. Best-effort. */
export async function updateDropoffEvent(
  eventId: string,
  e: DropoffEvent
): Promise<void> {
  if (!gcalEnabled() || !eventId) return;
  const cal = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID as string);
  await authedFetch(`/calendars/${cal}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(eventBody(e)),
  });
}

/** Remove an event (on cancel). Best-effort. */
export async function deleteDropoffEvent(eventId: string): Promise<void> {
  if (!gcalEnabled() || !eventId) return;
  const cal = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID as string);
  await authedFetch(`/calendars/${cal}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}
