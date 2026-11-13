import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * Staff directory — names + phone numbers of active team members only.
 * Visible to any signed-in user. Deliberately excludes email, emergency
 * contact, pay, and everything else personal.
 */
export async function GET() {
  await ensureSchema();
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const rows = await sql`
    SELECT id, name, phone FROM team_members WHERE active = true ORDER BY name ASC
  `;
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
