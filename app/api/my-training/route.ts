import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser, getTeamSettings } from "@/lib/team";

/** GET — the signed-in staffer's own training checklist (read-only). */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ steps: [], progress: {} });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ steps: [], progress: {} });
  const settings = await getTeamSettings();
  const rows = await sql`SELECT step_key, done FROM training_progress WHERE member_id = ${member.id}`;
  const progress: Record<string, boolean> = {};
  for (const r of rows as { step_key: string; done: boolean }[]) progress[r.step_key] = r.done;
  return NextResponse.json({ steps: settings.training_steps, progress }, { headers: { "Cache-Control": "no-store" } });
}
