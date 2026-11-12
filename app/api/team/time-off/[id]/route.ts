import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/team";
import { fmtShort } from "@/lib/dates";
import { sendTimeOffDecision } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH — approve or deny a time-off request. Body: { status: 'approved'|'denied', note? } */
export async function PATCH(request: Request, { params }: Ctx) {
  await ensureSchema();
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { id } = await params;
  const tid = Number(id);
  const b = await request.json().catch(() => ({}));
  const status = b.status === "approved" ? "approved" : b.status === "denied" ? "denied" : null;
  if (!status) return NextResponse.json({ error: "status must be approved or denied" }, { status: 400 });

  const rows = await sql`
    UPDATE time_off SET status = ${status}, decided_note = ${b.note || null}, decided_at = now()
    WHERE id = ${tid}
    RETURNING team_member_id, to_char(start_date,'YYYY-MM-DD') AS start_date,
              to_char(end_date,'YYYY-MM-DD') AS end_date
  `;
  const r = rows[0];
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const range = r.start_date === r.end_date ? fmtShort(r.start_date) : `${fmtShort(r.start_date)} – ${fmtShort(r.end_date)}`;
  const m = (await sql`SELECT name, email FROM team_members WHERE id = ${r.team_member_id}`)[0];
  const approved = status === "approved";

  // conflicts with assigned shifts (so the owner knows coverage is needed)
  const conflicts = await sql`
    SELECT COUNT(*)::int AS n FROM shifts
    WHERE team_member_id = ${r.team_member_id}
      AND shift_date >= ${r.start_date} AND shift_date <= ${r.end_date}
  `;

  await createNotification({
    memberId: r.team_member_id,
    kind: "timeoff_decision",
    title: `Time off ${approved ? "approved" : "declined"}`,
    body: `${range}${b.note ? ` — ${b.note}` : ""}`,
    link: "/my-shifts",
  });
  if (m?.email) {
    try {
      await sendTimeOffDecision({ to: m.email, name: m.name, approved, rangeLabel: range, note: b.note || undefined });
    } catch {
      /* non-fatal */
    }
  }

  await logAudit(approved ? "timeoff_approve" : "timeoff_deny", { entity: "time_off", entityId: tid }, admin);
  return NextResponse.json({ ok: true, status, assigned_shift_conflicts: conflicts[0].n });
}
