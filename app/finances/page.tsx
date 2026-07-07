"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { ItemStatus, Ownership, statusLabel, Tier } from "@/lib/types";
import { toISO, todayISO } from "@/lib/dates";

type Period = {
  rentals: number;
  rental_revenue: number;
  cleaning_fee_revenue: number;
  late_fees: number;
  cleaning_cost: number;
  sales_tax: number;
  total: number;
  net: number;
};

type Piece = {
  id: string;
  brand: string;
  size: string;
  tier: Tier;
  ownership: Ownership;
  status: ItemStatus;
  photo_url: string | null;
  purchase_cost: string | null;
  rental_count: number;
  revenue: number;
  borrow_revenue: number;
  paid_off: boolean | null;
};

type Finances = {
  week: Period;
  month: Period;
  all_time: Period;
  pieces: Piece[];
};

function money(n: number | string): string {
  const v = Number(n);
  return `$${v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function weekStartISO(): string {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() - n.getDay());
  return toISO(d);
}

function monthStartISO(): string {
  const n = new Date();
  return toISO(new Date(n.getFullYear(), n.getMonth(), 1));
}

function PeriodCard({ title, p }: { title: string; p: Period }) {
  return (
    <div className="rounded-2xl bg-white p-5">
      <p className="text-xs uppercase tracking-[0.2em] text-ink/45">{title}</p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="font-serif text-4xl font-semibold">{money(p.total)}</span>
        <span className="text-sm text-ink/50">
          {p.rentals} rental{p.rentals === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-3 space-y-1 text-[13px] text-ink/60">
        <div className="flex justify-between">
          <span>Rentals</span>
          <span>{money(p.rental_revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span>Cleaning &amp; Care Fees</span>
          <span>{money(p.cleaning_fee_revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span>Late fees</span>
          <span>{money(p.late_fees)}</span>
        </div>
        <div className="flex justify-between text-blush-deep">
          <span>Cleaning costs (absorbed)</span>
          <span>−{money(p.cleaning_cost)}</span>
        </div>
        <div className="flex justify-between border-t border-ink/10 pt-1 font-medium text-ink/80">
          <span>Net</span>
          <span>{money(p.net)}</span>
        </div>
        {p.sales_tax > 0 && (
          <div className="mt-1 flex justify-between text-[13px] text-ink/45">
            <span>Sales tax collected (to remit)</span>
            <span>{money(p.sales_tax)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FinancesPage() {
  const [data, setData] = useState<Finances | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const qs = new URLSearchParams({
        week_start: weekStartISO(),
        month_start: monthStartISO(),
        today: todayISO(),
      });
      const res = await fetch(`/api/finances?${qs}`);
      if (res.ok) setData(await res.json());
      else setError("Couldn't load finances — refresh to try again.");
    })();
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="text-4xl font-medium md:text-5xl">Finances</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Revenue counts at pickup · consignment shown as BORROW&apos;s 40%
        </p>

        {error ? (
          <p className="mt-16 text-center text-ink/50">{error}</p>
        ) : !data ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <PeriodCard title="This week" p={data.week} />
              <PeriodCard title="This month" p={data.month} />
            </div>
            <p className="mt-3 text-right text-sm text-ink/50">
              All time: {money(data.all_time.total)} across{" "}
              {data.all_time.rentals} rentals
            </p>

            <h2 className="mt-10 text-2xl font-medium">Piece performance</h2>
            <p className="mt-1 text-sm text-ink/50">
              Owned pieces break even around 5 rentals — the bar tracks revenue
              against what you paid.
            </p>
            <div className="mt-4 space-y-2">
              {data.pieces.length === 0 ? (
                <p className="rounded-2xl bg-white p-5 text-sm text-ink/45">
                  No pieces yet — performance shows up once things rent.
                </p>
              ) : (
                data.pieces.map((p) => {
                  const cost =
                    p.purchase_cost != null ? Number(p.purchase_cost) : null;
                  const progress =
                    p.ownership === "owned" && cost && cost > 0
                      ? Math.min(1, p.borrow_revenue / cost)
                      : null;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 rounded-2xl bg-white p-3"
                    >
                      <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                        {p.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.photo_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
                            {p.brand.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">
                            {p.brand}
                          </span>{" "}
                          <span className="text-ink/50">
                            {p.id} · {p.size}
                          </span>
                          {p.status === "retired" && (
                            <span className="ml-1.5 text-[11px] uppercase tracking-wider text-ink/40">
                              {statusLabel(p.status)}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          rented {p.rental_count}× ·{" "}
                          {p.ownership === "consignment"
                            ? `consignment · BORROW share ${money(p.borrow_revenue)}`
                            : cost && cost > 0
                              ? `${money(p.borrow_revenue)} of ${money(cost)} cost`
                              : `${money(p.borrow_revenue)} revenue`}
                        </p>
                        {progress !== null && (
                          <div className="mt-1.5 h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-ink/8">
                            <div
                              className={`h-full rounded-full ${progress >= 1 ? "bg-sage-deep" : "bg-blush-deep"}`}
                              style={{ width: `${progress * 100}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {p.paid_off === true && (
                        <span className="shrink-0 rounded-full bg-sage px-2.5 py-1 text-[11px] font-medium">
                          paid for itself
                        </span>
                      )}
                      <span className="shrink-0 text-right font-serif text-lg font-semibold">
                        {money(p.borrow_revenue)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
