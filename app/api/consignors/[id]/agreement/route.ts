import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import {
  CONSIGNOR_AGREEMENT_VERSION,
  CONSIGNOR_AGREEMENT_TITLE,
  CONSIGNOR_AGREEMENT_INTRO,
  consignorAgreementBody,
} from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Best-effort client IP from the proxy headers Vercel sets. */
function clientIp(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

/**
 * The rate (%) this consignor locks in, and WHY (for admin visibility):
 *  - an already-locked rate is kept, untouched (never auto-changed);
 *  - otherwise the rate in effect (per consignor_rate_schedule) on whichever
 *    came FIRST — their earliest drop-off booking or today (signing) — floored
 *    at any rate they were actually promised in a drop-off email, so we never
 *    pay below what they were told.
 */
async function rateForConsignor(c: {
  id: number;
  email: string | null;
  phone: string | null;
  consignor_rate: number | null;
}): Promise<{ rate: number; basis: string; basisDate: string | null }> {
  if (c.consignor_rate != null) {
    return { rate: Number(c.consignor_rate), basis: "locked", basisDate: null };
  }
  const email = (c.email || "").trim().toLowerCase();
  const digits = (c.phone || "").replace(/\D/g, "");
  // Earliest booking date + the highest rate they were promised on any matched
  // appointment; the rate in effect on the earlier of (that booking, today);
  // and today's rate for the no-appointment case.
  const rows = await sql`
    WITH mine AS (
      SELECT MIN(created_at)::date AS first_booking, MAX(promised_rate)::int AS promised
      FROM drop_off_appointments
      WHERE consignor_id = ${c.id}
         OR (${email} <> '' AND lower(email) = ${email})
         OR (${digits} <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ${digits})
    )
    SELECT
      to_char(COALESCE((SELECT first_booking FROM mine), (now() AT TIME ZONE 'America/Chicago')::date), 'YYYY-MM-DD') AS basis_date,
      ((SELECT first_booking FROM mine) IS NOT NULL) AS from_booking,
      (SELECT promised FROM mine) AS promised,
      (SELECT s.rate FROM consignor_rate_schedule s
        WHERE s.effective_from <= COALESCE((SELECT first_booking FROM mine), (now() AT TIME ZONE 'America/Chicago')::date)
        ORDER BY s.effective_from DESC LIMIT 1) AS schedule_rate
  `;
  const r = rows[0] || {};
  const scheduleRate = Number(r.schedule_rate ?? 60);
  const promised = r.promised != null ? Number(r.promised) : 0;
  const rate = Math.max(scheduleRate, promised); // never below what we promised
  return {
    rate,
    basis: r.from_booking ? "appointment booking" : "new default",
    basisDate: r.basis_date ?? null,
  };
}

async function loadConsignor(id: string) {
  const rows = await sql`
    SELECT id, email, phone, consignor_rate, agreement_signed_at
    FROM consignors WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

/** The exact agreement text this consignor would sign, at their locked rate. */
export async function GET(_req: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const c = await loadConsignor(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rate } = await rateForConsignor(c);
  return NextResponse.json({
    rate,
    title: CONSIGNOR_AGREEMENT_TITLE,
    intro: CONSIGNOR_AGREEMENT_INTRO,
    body: consignorAgreementBody(rate),
    version: CONSIGNOR_AGREEMENT_VERSION,
  });
}

/**
 * Records a consignor's digital signature of the Consignor Agreement. Locks in
 * their commission rate (once) and snapshots the exact rate + text they agreed
 * to, so their historical agreement is unaffected by future default/text changes.
 */
export async function POST(request: Request, ctx: Ctx) {
  await ensureSchema();
  const { id } = await ctx.params;
  const b = await request.json().catch(() => ({}));

  const name = (b.name || "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "Type your full legal name to sign." },
      { status: 400 }
    );
  }
  if (b.agreed !== true) {
    return NextResponse.json(
      { error: "You must check the box to agree before signing." },
      { status: 400 }
    );
  }

  const c = await loadConsignor(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Authoritative rate (server-side); an already-locked rate is kept untouched.
  const { rate } = await rateForConsignor(c);
  const terms = consignorAgreementBody(rate).join("\n");

  const rows = await sql`
    UPDATE consignors SET
      agreement_signed_name = ${name},
      agreement_signed_at = now(),
      agreement_signed_ip = ${clientIp(request)},
      agreement_version = ${CONSIGNOR_AGREEMENT_VERSION},
      consignor_rate = COALESCE(consignor_rate, ${rate}),
      agreement_signed_rate = ${rate},
      agreement_signed_terms = ${terms}
    WHERE id = ${id}
    RETURNING *
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}
