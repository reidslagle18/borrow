import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser, getTeamSettings, createNotification } from "@/lib/team";

/** Resolve the caller's member + whether they may touch this shift's checklist. */
async function access(shiftId: number) {
  const session = await getSession();
  if (!session) return { error: "Please sign in first.", status: 401 as const };
  const isAdmin = session.trueRole === "admin" && !session.viewAs;
  const member = session.userId != null ? await memberForStaffUser(session.userId) : null;
  const shift = (await sql`SELECT id, team_member_id, to_char(shift_date,'YYYY-MM-DD') AS shift_date FROM shifts WHERE id = ${shiftId}`)[0];
  if (!shift) return { error: "Shift not found.", status: 404 as const };
  if (!isAdmin && (!member || shift.team_member_id !== member.id))
    return { error: "This isn't your shift.", status: 403 as const };
  return { session, member, isAdmin, shift };
}

/** GET ?shift_id=&type=opening|closing — materialize from the template if needed, return items. */
export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const shiftId = Number(url.searchParams.get("shift_id"));
  const type = url.searchParams.get("type") === "closing" ? "closing" : "opening";
  if (!shiftId) return NextResponse.json({ error: "Missing shift." }, { status: 400 });

  const a = await access(shiftId);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });

  let items = await sql`SELECT id, position, label, checked, checked_by, to_char(checked_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS checked_at
                        FROM checklist_items WHERE shift_id = ${shiftId} AND type = ${type} ORDER BY position ASC`;
  if (items.length === 0) {
    const settings = await getTeamSettings();
    const template = type === "opening" ? settings.checklist_opening : settings.checklist_closing;
    for (let i = 0; i < template.length; i++) {
      await sql`INSERT INTO checklist_items (shift_id, type, position, label) VALUES (${shiftId}, ${type}, ${i}, ${template[i]})
                ON CONFLICT (shift_id, type, position) DO NOTHING`;
    }
    items = await sql`SELECT id, position, label, checked, checked_by, to_char(checked_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS checked_at
                      FROM checklist_items WHERE shift_id = ${shiftId} AND type = ${type} ORDER BY position ASC`;
  }
  const run = (await sql`SELECT to_char(submitted_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS submitted_at, submitted_by, incomplete_count
                         FROM checklist_runs WHERE shift_id = ${shiftId} AND type = ${type}`)[0] || null;
  return NextResponse.json({ items, run }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST — toggle an item or submit the checklist.
 * Body: { shift_id, type, item_id, checked }  OR  { shift_id, type, action: "submit" }
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const shiftId = Number(b.shift_id);
  const type = b.type === "closing" ? "closing" : "opening";
  if (!shiftId) return NextResponse.json({ error: "Missing shift." }, { status: 400 });

  const a = await access(shiftId);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });
  const who = a.member?.name || a.session?.name || "Staff";

  if (b.action === "submit") {
    const incomplete = (await sql`SELECT COUNT(*)::int AS n FROM checklist_items WHERE shift_id = ${shiftId} AND type = ${type} AND checked = false`)[0].n;
    await sql`INSERT INTO checklist_runs (shift_id, type, submitted_by, submitted_at, incomplete_count)
              VALUES (${shiftId}, ${type}, ${who}, now(), ${incomplete})
              ON CONFLICT (shift_id, type) DO UPDATE SET submitted_by = EXCLUDED.submitted_by, submitted_at = now(), incomplete_count = EXCLUDED.incomplete_count`;
    if (type === "closing" && incomplete > 0) {
      await createNotification({
        toAdmin: true,
        kind: "checklist_incomplete",
        title: "Closing checklist incomplete",
        body: `${who} closed with ${incomplete} item${incomplete === 1 ? "" : "s"} unchecked (${a.shift.shift_date}).`,
        link: "/team/timesheets",
      });
    }
    return NextResponse.json({ ok: true, incomplete });
  }

  // toggle an item
  const itemId = Number(b.item_id);
  if (b.checked) {
    await sql`UPDATE checklist_items SET checked = true, checked_by = ${who}, checked_at = now()
              WHERE id = ${itemId} AND shift_id = ${shiftId} AND type = ${type}`;
  } else {
    await sql`UPDATE checklist_items SET checked = false, checked_by = NULL, checked_at = NULL
              WHERE id = ${itemId} AND shift_id = ${shiftId} AND type = ${type}`;
  }
  return NextResponse.json({ ok: true });
}
