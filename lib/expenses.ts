import { sql } from "@/lib/db";

export type ExpenseTotals = { by_category: Record<string, number>; total: number };

/**
 * Total logged expenses for the inclusive date window [from, to]:
 *  - manual entries (expense_log),
 *  - auto Cleaning Service (cleaning_expenses),
 *  - auto Stripe Fees (transactions.stripe_fee).
 * Auto sources are merged here rather than copied into expense_log, so there's
 * no double-counting. A manual 'cleaning'/'stripe_fees' entry adds on top.
 */
export async function sumExpenses(from: string, to: string): Promise<ExpenseTotals> {
  const [manual, cleaning, stripe] = await Promise.all([
    sql`SELECT category, COALESCE(SUM(amount), 0) AS total FROM expense_log
        WHERE incurred_on >= ${from} AND incurred_on <= ${to} GROUP BY category`,
    sql`SELECT COALESCE(SUM(amount), 0) AS total FROM cleaning_expenses
        WHERE incurred_on >= ${from} AND incurred_on <= ${to}`,
    sql`SELECT COALESCE(SUM(stripe_fee), 0) AS total FROM transactions
        WHERE stripe_fee IS NOT NULL AND created_at::date >= ${from} AND created_at::date <= ${to}`,
  ]);
  const by: Record<string, number> = {};
  for (const r of manual) by[String(r.category)] = Number(r.total);
  by.cleaning = Math.round(((by.cleaning || 0) + Number(cleaning[0].total)) * 100) / 100;
  by.stripe_fees = Math.round(((by.stripe_fees || 0) + Number(stripe[0].total)) * 100) / 100;
  const total = Object.values(by).reduce((s, v) => s + v, 0);
  return { by_category: by, total: Math.round(total * 100) / 100 };
}
