// Node-runtime auth helpers (DB + next/headers). NOT edge-safe — do not import
// from proxy.ts (use lib/session.ts there instead).
import { cookies } from "next/headers";
import { sql, ensureSchema } from "@/lib/db";
import {
  SESSION_COOKIE,
  VIEWAS_COOKIE,
  verifyToken,
} from "@/lib/session";

export type Role = "admin" | "staff";

export type Session = {
  /** The real role of whoever is logged in. */
  trueRole: Role;
  /** What the UI should render as — admin + "view as staff" ⇒ "staff". */
  effectiveRole: Role;
  /** staff_users.id, or null for the owner (APP_PASSWORD login). */
  userId: number | null;
  /** Display name, snapshotted into the audit log. */
  name: string;
  /** Whether the admin is currently previewing the staff experience. */
  viewAs: boolean;
};

/**
 * Resolve the current request's session from the cookie. Returns null when
 * unauthenticated OR when a staff login has been disabled (so a one-click
 * disable logs them out on their next data request even though the signed
 * cookie is stateless).
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const id = await verifyToken(jar.get(SESSION_COOKIE)?.value);
  if (!id) return null;

  const viewAs = jar.get(VIEWAS_COOKIE)?.value === "1";

  if (id.kind === "admin") {
    return {
      trueRole: "admin",
      effectiveRole: viewAs ? "staff" : "admin",
      userId: null,
      name: "Owner",
      viewAs,
    };
  }

  // Staff: re-check the row every request so disable/role changes take effect.
  await ensureSchema();
  const rows = await sql`
    SELECT id, name, role, active FROM staff_users WHERE id = ${id.userId}
  `;
  const u = rows[0];
  if (!u || u.active === false) return null; // disabled or deleted ⇒ logged out
  const trueRole: Role = u.role === "admin" ? "admin" : "staff";
  return {
    trueRole,
    effectiveRole: trueRole === "admin" && viewAs ? "staff" : trueRole,
    userId: Number(u.id),
    name: u.name as string,
    viewAs: trueRole === "admin" ? viewAs : false,
  };
}

/** Session if the caller is a real admin (ignoring view-as), else null. */
export async function requireAdmin(): Promise<Session | null> {
  const s = await getSession();
  return s && s.trueRole === "admin" ? s : null;
}

/* ----------------------------- password hashing ------------------------------ */
// PBKDF2-SHA256 via Web Crypto (available in the Node 20 runtime). Format:
//   pbkdf2$<iterations>$<saltB64>$<hashB64>

const ITERATIONS = 120_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = (stored || "").split("$");
  if (scheme !== "pbkdf2") return false;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const salt = fromB64(saltB64);
  const bits = await deriveBits(password, salt, iterations);
  const got = b64(new Uint8Array(bits));
  // Constant-time-ish comparison.
  if (got.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password) as unknown as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    256
  );
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}
