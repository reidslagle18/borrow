import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { CLOCK_DEVICE_COOKIE, deviceFromToken, writeTimeAudit, openEntryForMember } from "@/lib/timeclock";
import { memberForStaffUser } from "@/lib/team";

/**
 * Clock in / out. Requires a signed-in staffer AND a registered device cookie.
 * Stores EXACT timestamps (now()); never rounds, deducts breaks, or auto-closes.
 * Body: { action: "in" | "out" }
 */
export async function POST(request: Request) {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const token = (await cookies()).get(CLOCK_DEVICE_COOKIE)?.value;
  const device = await deviceFromToken(token);
  if (!device) return NextResponse.json({ error: "This device isn't set up for clocking." }, { status: 403 });

  const member = session.userId != null ? await memberForStaffUser(session.userId) : null;
  if (!member) return NextResponse.json({ error: "No team profile is linked to your login yet." }, { status: 400 });

  const b = await request.json().catch(() => ({}));
  const action = b.action === "out" ? "out" : b.action === "in" ? "in" : null;
  if (!action) return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const open = await openEntryForMember(member.id);
  const todayShift = (
    await sql`SELECT id, start_time, end_time FROM shifts
             WHERE team_member_id = ${member.id}
               AND shift_date = (now() AT TIME ZONE 'America/Chicago')::date LIMIT 1`
  )[0];

  if (action === "in") {
    if (open) return NextResponse.json({ error: "You're already clocked in." }, { status: 409 });
    let early = false;
    if (todayShift?.start_time) {
      early = (
        await sql`SELECT (now() AT TIME ZONE 'America/Chicago')::time < ${todayShift.start_time}::time AS e`
      )[0].e;
    }
    const rows = await sql`
      INSERT INTO time_entries (team_member_id, clock_in, source, device_id, shift_id, status, early_arrival)
      VALUES (${member.id}, now(), 'clock', ${device.id}, ${todayShift?.id ?? null}, 'open', ${early})
      RETURNING id, to_char(clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in
    `;
    await sql`UPDATE clock_devices SET last_seen_at = now() WHERE id = ${device.id}`;
    await writeTimeAudit({
      entryId: rows[0].id,
      session,
      action: "clock_in",
      after: { clock_in: rows[0].clock_in, device: device.name, early_arrival: early },
    });
    return NextResponse.json({ ok: true, action: "in", entry_id: rows[0].id, early_arrival: early, clock_in: rows[0].clock_in });
  }

  // action === "out"
  if (!open) return NextResponse.json({ error: "You're not clocked in." }, { status: 409 });
  let late = false;
  if (todayShift?.end_time) {
    late = (await sql`SELECT (now() AT TIME ZONE 'America/Chicago')::time > ${todayShift.end_time}::time AS l`)[0].l;
  }
  const rows = await sql`
    UPDATE time_entries
    SET clock_out = now(), status = 'completed', late_clockout = ${late},
        missed_clockout = false, updated_at = now()
    WHERE id = ${open.id}
    RETURNING id, to_char(clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
              to_char(clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out
  `;
  await sql`UPDATE clock_devices SET last_seen_at = now() WHERE id = ${device.id}`;
  await writeTimeAudit({
    entryId: open.id,
    session,
    action: "clock_out",
    after: { clock_out: rows[0].clock_out, late_clockout: late },
  });
  return NextResponse.json({ ok: true, action: "out", late_clockout: late, clock_out: rows[0].clock_out });
}
