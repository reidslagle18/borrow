import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getTeamSettings } from "@/lib/team";

/** GET — per-member training checklist progress (admin). */
export async function GET() {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const settings = await getTeamSettings();
  const members = await sql`SELECT id, name FROM team_members WHERE active = true ORDER BY name ASC`;
  const prog = await sql`
    SELECT member_id, step_key, done, to_char(done_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS done_at
    FROM training_progress
  `;
  const byMember: Record<number, Record<string, { done: boolean; done_at: string | null }>> = {};
  for (const p of prog as { member_id: number; step_key: string; done: boolean; done_at: string | null }[]) {
    (byMember[p.member_id] ||= {})[p.step_key] = { done: p.done, done_at: p.done_at };
  }
  return NextResponse.json({ steps: settings.training_steps, members, progress: byMember }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — set a training step done/undone for a member (admin). Body: { member_id, step_key, done } */
export async function POST(request: Request) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const memberId = Number(b.member_id);
  const step = String(b.step_key || "").trim();
  const done = !!b.done;
  if (!memberId || !step) return NextResponse.json({ error: "Missing member or step." }, { status: 400 });
  if (done) {
    await sql`INSERT INTO training_progress (member_id, step_key, done, done_by, done_at)
              VALUES (${memberId}, ${step}, true, ${admin.name}, now())
              ON CONFLICT (member_id, step_key) DO UPDATE SET done = true, done_by = ${admin.name}, done_at = now()`;
  } else {
    await sql`INSERT INTO training_progress (member_id, step_key, done) VALUES (${memberId}, ${step}, false)
              ON CONFLICT (member_id, step_key) DO UPDATE SET done = false, done_by = NULL, done_at = NULL`;
  }
  await logAudit("training_update", { entity: "team_member", entityId: memberId, detail: { step, done } }, admin);
  return NextResponse.json({ ok: true });
}
