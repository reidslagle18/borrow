import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { memberForStaffUser } from "@/lib/team";

/** The logged-in staffer's recurring weekly availability + one-off unavailable dates. */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.userId == null) return NextResponse.json({ member: null, weekly: {}, dates: [] });

  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ member: null, weekly: {}, dates: [] });

  const [avail, dates] = await Promise.all([
    sql`SELECT weekday, available FROM availability WHERE team_member_id = ${member.id}`,
    sql`SELECT id, to_char(the_date,'YYYY-MM-DD') AS the_date, note FROM unavailable_dates
        WHERE team_member_id = ${member.id} AND the_date >= (now() AT TIME ZONE 'America/Chicago')::date
        ORDER BY the_date ASC`,
  ]);
  const weekly: Record<number, boolean> = {};
  for (const a of avail as { weekday: number; available: boolean }[]) weekly[a.weekday] = a.available;

  return NextResponse.json({ member: { id: member.id, name: member.name }, weekly, dates }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PUT — save recurring availability and/or add/remove a one-off unavailable date.
 * Body: { weekly?: {0..6: boolean}, add_date?: {date, note}, remove_date_id?: number }
 */
export async function PUT(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session || session.userId == null) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const member = await memberForStaffUser(session.userId);
  if (!member) return NextResponse.json({ error: "No team profile linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));

  if (b.weekly && typeof b.weekly === "object") {
    for (let wd = 0; wd <= 6; wd++) {
      if (!(wd in b.weekly)) continue;
      const available = !!b.weekly[wd];
      await sql`
        INSERT INTO availability (team_member_id, weekday, available)
        VALUES (${member.id}, ${wd}, ${available})
        ON CONFLICT (team_member_id, weekday) DO UPDATE SET available = EXCLUDED.available
      `;
    }
  }

  if (b.add_date?.date) {
    await sql`
      INSERT INTO unavailable_dates (team_member_id, the_date, note)
      VALUES (${member.id}, ${String(b.add_date.date).slice(0, 10)}, ${b.add_date.note || null})
      ON CONFLICT (team_member_id, the_date) DO UPDATE SET note = EXCLUDED.note
    `;
  }
  if (b.remove_date_id) {
    await sql`DELETE FROM unavailable_dates WHERE id = ${Number(b.remove_date_id)} AND team_member_id = ${member.id}`;
  }

  return NextResponse.json({ ok: true });
}
