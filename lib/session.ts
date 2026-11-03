// Pure, edge-safe session-token helpers (no DB, no next/headers). Imported by
// proxy.ts (middleware, edge runtime) AND by the Node auth helpers in lib/auth.ts.
//
// Two kinds of session live in the same `borrow_session` cookie:
//   • Owner (admin): token = sha256("borrow:" + APP_PASSWORD). Unchanged from the
//     original single-password scheme, so the owner's existing session keeps
//     working and the owner never needs a staff row.
//   • Staff: token = "st1.<userId>.<sig>" where sig = sha256(APP_PASSWORD +
//     ":staff:" + userId). APP_PASSWORD is the signing secret (never shared with
//     staff), so staff can't forge a token or elevate to another id.
//
// The signature only proves "this is a valid session of this kind for this id."
// Whether a staff login is still ACTIVE is re-checked against the DB on every
// data request (see lib/auth.ts getSession), so disabling a login takes effect
// immediately even though the cookie is stateless.

export const SESSION_COOKIE = "borrow_session";
export const VIEWAS_COOKIE = "borrow_viewas";

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function adminToken(): Promise<string> {
  return sha256hex(`borrow:${process.env.APP_PASSWORD}`);
}

export async function staffToken(userId: number): Promise<string> {
  const sig = await sha256hex(`${process.env.APP_PASSWORD}:staff:${userId}`);
  return `st1.${userId}.${sig}`;
}

export type TokenIdentity =
  | { kind: "admin" }
  | { kind: "staff"; userId: number };

/** Signature-only verification (no DB). Returns null for an invalid token. */
export async function verifyToken(
  token: string | undefined | null
): Promise<TokenIdentity | null> {
  if (!token || !process.env.APP_PASSWORD) return null;
  if (token === (await adminToken())) return { kind: "admin" };
  if (token.startsWith("st1.")) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const userId = Number(parts[1]);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (token === (await staffToken(userId))) return { kind: "staff", userId };
  }
  return null;
}
