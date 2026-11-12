import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { CLOCK_DEVICE_COOKIE, deviceFromToken } from "@/lib/timeclock";
import { memberForStaffUser } from "@/lib/team";

/** Everything the /clock screen needs for the signed-in staffer on THIS device. */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  const token = (await cookies()).get(CLOCK_DEVICE_COOKIE)?.value;
  const device = await deviceFromToken(token);

  if (!session) {
    return NextResponse.json({ signed_in: false, device_registered: !!device, device_name: device?.name ?? null });
  }
  if (device) await sql`UPDATE clock_devices SET last_seen_at = now() WHERE id = ${device.id}`;

  const member = session.userId != null ? await memberForStaffUser(session.userId) : null;
  if (!member) {
    return NextResponse.json({
      signed_in: true,
      device_registered: !!device,
      device_name: device?.name ?? null,
      member: null,
    });
  }

  const [shiftRows, openRows, recent] = await Promise.all([
    sql`SELECT id, start_time, end_time, is_training FROM shifts
        WHERE team_member_id = ${member.id}
          AND shift_date = (now() AT TIME ZONE 'America/Chicago')::date LIMIT 1`,
    sql`SELECT id, to_char(clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in, missed_clockout
        FROM time_entries
        WHERE team_member_id = ${member.id} AND clock_out IS NULL AND archived_at IS NULL
        ORDER BY clock_in DESC LIMIT 1`,
    sql`SELECT id, to_char(clock_in,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_in,
               to_char(clock_out,'YYYY-MM-DD"T"HH24:MI:SSOF') AS clock_out,
               status, source, missed_clockout
        FROM time_entries
        WHERE team_member_id = ${member.id} AND archived_at IS NULL
        ORDER BY clock_in DESC LIMIT 5`,
  ]);

  return NextResponse.json(
    {
      signed_in: true,
      device_registered: !!device,
      device_name: device?.name ?? null,
      member: { id: member.id, name: member.name },
      today_shift: shiftRows[0] || null,
      open_entry: openRows[0] || null,
      recent,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
