import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { sumExpenses } from "@/lib/expenses";
import { todayISO } from "@/lib/dates";

const CATEGORIES = [
  "cleaning",
  "stripe_fees",
  "rent",
  "marketing",
  "supplies",
  "loan_interest",
  "donation",
  "other",
];

/**
 * GET /api/expenses?from=&to=&category=  — merged expense entries + totals.
 * Entries = manual (editable) + auto Cleaning (from cleaning_expenses) + one
 * aggregated Stripe Fees line (from transactions.stripe_fee), for the range.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "2000-01-01";
  const to = searchParams.get("to") || "9999-12-31";
  const category = searchParams.get("category") || "";

  type Entry = {
    id: string;
    source: "manual" | "cleaning" | "stripe";
    category: string;
    incurred_on: string;
    amount: number;
    note: string | null;
    editable: boolean;
  };
  const entries: Entry[] = [];

  const manual = await sql`
    SELECT id, to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, category, amount, note
    FROM expense_log
    WHERE incurred_on >= ${from} AND incurred_on <= ${to}
    ORDER BY incurred_on DESC, id DESC
  `;
  for (const r of manual) {
    entries.push({
      id: `m${r.id}`,
      source: "manual",
      category: String(r.category),
      incurred_on: String(r.incurred_on),
      amount: Number(r.amount),
      note: r.note ?? null,
      editable: true,
    });
  }

  // Auto: cleaning costs (each a discrete real cost).
  if (!category || category === "cleaning") {
    const cleaning = await sql`
      SELECT id, to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, amount, reason
      FROM cleaning_expenses
      WHERE incurred_on >= ${from} AND incurred_on <= ${to}
      ORDER BY incurred_on DESC, id DESC
    `;
    for (const r of cleaning) {
      entries.push({
        id: `c${r.id}`,
        source: "cleaning",
        category: "cleaning",
        incurred_on: String(r.incurred_on),
        amount: Number(r.amount),
        note: (r.reason ? `${r.reason} · ` : "") + "auto from cleaning log",
        editable: false,
      });
    }
  }

  // Auto: Stripe fees aggregated into one line for the range.
  if (!category || category === "stripe_fees") {
    const stripe = await sql`
      SELECT COALESCE(SUM(stripe_fee), 0) AS total, COUNT(*)::int AS n
      FROM transactions
      WHERE stripe_fee IS NOT NULL AND created_at::date >= ${from} AND created_at::date <= ${to}
    `;
    const total = Number(stripe[0].total);
    if (total > 0) {
      entries.push({
        id: "stripe-agg",
        source: "stripe",
        category: "stripe_fees",
        incurred_on: to === "9999-12-31" ? from : to,
        amount: Math.round(total * 100) / 100,
        note: `auto from ${stripe[0].n} card transaction${stripe[0].n === 1 ? "" : "s"}`,
        editable: false,
      });
    }
  }

  const filtered = category ? entries.filter((e) => e.category === category) : entries;
  filtered.sort((a, b) => (a.incurred_on < b.incurred_on ? 1 : -1));
  const totals = await sumExpenses(from, to);

  return NextResponse.json(
    { entries: filtered, totals, categories: CATEGORIES },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** POST /api/expenses — add a manual expense. */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const category = String(b.category || "");
  const amount = Math.round(Number(b.amount) * 100) / 100;
  const incurredOn = /^\d{4}-\d{2}-\d{2}$/.test(String(b.incurred_on))
    ? String(b.incurred_on)
    : null;
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Pick a valid category." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than 0." }, { status: 400 });
  }
  const rows = await sql`
    INSERT INTO expense_log (incurred_on, category, amount, note)
    VALUES (${incurredOn ?? todayISO()}, ${category}, ${amount}, ${b.note?.toString().trim() || null})
    RETURNING id
  `;
  return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
}
