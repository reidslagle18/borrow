import { sql, ensureSchema } from "@/lib/db";
import { getSession, type Session } from "@/lib/auth";

type AuditOpts = {
  entity?: string;
  entityId?: string | number | null;
  detail?: Record<string, unknown> | null;
};

/**
 * Record who did something, with a name + timestamp. Best-effort: an audit
 * failure must never block or fail the underlying action, so everything is
 * wrapped and swallowed. Pass `session` when the caller already resolved it to
 * avoid a second cookie/DB round-trip.
 */
export async function logAudit(
  action: string,
  opts: AuditOpts = {},
  session?: Session | null
): Promise<void> {
  try {
    const s = session === undefined ? await getSession() : session;
    await ensureSchema();
    const detailJson = opts.detail ? JSON.stringify(opts.detail) : null;
    await sql`
      INSERT INTO audit_log
        (actor_id, actor_name, actor_role, action, entity, entity_id, detail)
      VALUES (
        ${s?.userId ?? null},
        ${s?.name ?? "Unknown"},
        ${s?.trueRole ?? "unknown"},
        ${action},
        ${opts.entity ?? null},
        ${opts.entityId != null ? String(opts.entityId) : null},
        ${detailJson}::jsonb
      )
    `;
  } catch {
    /* never let auditing break the primary action */
  }
}
