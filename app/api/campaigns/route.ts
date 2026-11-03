import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { listCampaigns, normalizeCode } from "@/lib/campaigns";

/** Studio (session-gated via proxy): list + edit give-back campaigns. */
export async function GET() {
  await ensureSchema();
  return NextResponse.json({ campaigns: await listCampaigns() });
}

/**
 * Upsert a campaign (edit the code, org, rate, dates, active). Body:
 * { id?, code, label?, organization?, donation_rate?, starts_on?, ends_on?, active? }
 * Matched by id when given, else by code.
 */
export async function PUT(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const code = normalizeCode(b.code);
  if (!code || !/^[A-Z0-9]{2,20}$/.test(code)) {
    return NextResponse.json(
      { error: "Code must be 2–20 letters/numbers." },
      { status: 400 }
    );
  }
  const rate = Math.max(0, Math.min(100, Math.round(Number(b.donation_rate ?? 10) * 100) / 100));
  const org = String(b.organization ?? "").trim();
  const label = b.label != null ? String(b.label).trim() || null : null;
  const starts = /^\d{4}-\d{2}-\d{2}$/.test(String(b.starts_on)) ? String(b.starts_on) : null;
  const ends = /^\d{4}-\d{2}-\d{2}$/.test(String(b.ends_on)) ? String(b.ends_on) : null;
  const active = b.active !== false;
  const id = Number(b.id) || null;

  if (id) {
    const rows = await sql`
      UPDATE campaigns SET code = ${code}, label = ${label}, organization = ${org},
        donation_rate = ${rate}, starts_on = ${starts}, ends_on = ${ends}, active = ${active}
      WHERE id = ${id} RETURNING id
    `;
    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id: rows[0].id });
  }
  const rows = await sql`
    INSERT INTO campaigns (code, label, organization, donation_rate, starts_on, ends_on, active)
    VALUES (${code}, ${label}, ${org}, ${rate}, ${starts}, ${ends}, ${active})
    ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, organization = EXCLUDED.organization,
      donation_rate = EXCLUDED.donation_rate, starts_on = EXCLUDED.starts_on,
      ends_on = EXCLUDED.ends_on, active = EXCLUDED.active
    RETURNING id
  `;
  return NextResponse.json({ ok: true, id: rows[0].id });
}
