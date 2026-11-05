"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { ItemStatus, Ownership, statusLabel, Tier } from "@/lib/types";
import { toISO, todayISO } from "@/lib/dates";

type Period = {
  rentals: number;
  rental_revenue: number;
  cleaning_fee_revenue: number;
  extra_days_revenue: number;
  late_fees: number;
  cleaning_cost: number;
  sales_tax: number;
  reserved_revenue: number;
  total: number;
  total_incl_reserved: number;
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

type ReservedPrepaid = {
  count: number;
  amount: number;
  online_amount: number;
  instore_amount: number;
};

type DayRevenue = Period & { date: string };

type DayPaid = {
  date: string;
  reserved_rental: number;
  rented_rental: number;
  reserved_count: number;
  rented_count: number;
  late_fees: number;
  damage_replacement: number;
  missing_item_fees: number;
  fees_total: number;
  refunds: number;
  store_credit: number;
  sales_tax: number;
  reserved_total: number;
  rented_total: number;
  both_total: number;
};

type Summary = {
  from: string;
  to: string;
  rental_revenue: number;
  late_fees: number;
  damage_replacement: number;
  missing_item_fees: number;
  quick_charges: number;
  refunds: number;
  store_credit: number;
  consignor_payouts: number;
  net_take: number;
  sales_tax: number;
  reserved_prepaid: number;
  net_take_incl_reserved: number;
  everything_paid: number;
  borrow_made: number;
  expenses_total: number;
  expenses_by_category: Record<string, number>;
  estimated_profit: number;
};

type Finances = {
  week: Period;
  month: Period;
  all_time: Period;
  day_revenue: DayRevenue;
  day_paid: DayPaid;
  summary: Summary;
  reserved_prepaid: ReservedPrepaid;
  pieces: Piece[];
};

type ExpenseEntry = {
  id: string;
  source: "manual" | "cleaning" | "stripe";
  category: string;
  incurred_on: string;
  amount: number;
  note: string | null;
  editable: boolean;
};

const CAT_LABEL: Record<string, string> = {
  cleaning: "Cleaning Service",
  stripe_fees: "Stripe Fees",
  rent: "Rent",
  marketing: "Marketing / Ambassador",
  supplies: "Supplies",
  loan_interest: "Loan Interest",
  other: "Other",
};

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
  });
}

function money(n: number | string): string {
  const v = Number(n);
  return `$${v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signed(v: number): string {
  return v < 0 ? `−${money(Math.abs(v))}` : money(v);
}

function BRow({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{signed(v)}</span>
    </div>
  );
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
        {/* Historical only — the Cleaning & Care Fee is now included in each
            rental price, so this is $0 for current activity and hidden. */}
        {p.cleaning_fee_revenue > 0 && (
          <div className="flex justify-between">
            <span>Cleaning &amp; Care Fees (historical)</span>
            <span>{money(p.cleaning_fee_revenue)}</span>
          </div>
        )}
        {p.extra_days_revenue > 0 && (
          <div className="flex justify-between">
            <span>Extended rentals</span>
            <span>{money(p.extra_days_revenue)}</span>
          </div>
        )}
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
        {p.reserved_revenue > 0 && (
          <div className="mt-1 border-t border-dashed border-ink/10 pt-1">
            <div className="flex justify-between text-ink/55">
              <span>+ Reserved (prepaid)</span>
              <span>{money(p.reserved_revenue)}</span>
            </div>
            <div className="flex justify-between font-medium text-ink/80">
              <span>Incl. reservations</span>
              <span>{money(p.total_incl_reserved)}</span>
            </div>
          </div>
        )}
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

type RangePreset = "today" | "week" | "month" | "custom";

function rangeBounds(preset: RangePreset, from: string, to: string): { from: string; to: string } {
  const today = todayISO();
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") return { from: weekStartISO(), to: today };
  if (preset === "month") return { from: monthStartISO(), to: today };
  return { from: from || monthStartISO(), to: to || today };
}

export default function FinancesPage() {
  const [data, setData] = useState<Finances | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState(todayISO());
  const [dayFilter, setDayFilter] = useState<"both" | "reserved" | "rented">("both");
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customFrom, setCustomFrom] = useState(monthStartISO());
  const [customTo, setCustomTo] = useState(todayISO());
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const range = rangeBounds(preset, customFrom, customTo);

  useEffect(() => {
    (async () => {
      try {
        const qs = new URLSearchParams({
          week_start: weekStartISO(),
          month_start: monthStartISO(),
          today: todayISO(),
          day,
          range_from: range.from,
          range_to: range.to,
        });
        const res = await fetch(`/api/finances?${qs}`);
        if (res.ok) setData(await res.json());
        else setError("Couldn't load finances — refresh to try again.");
      } catch {
        setError("Couldn't load finances — refresh to try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, preset, customFrom, customTo, refreshKey]);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Finances</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Revenue counts at pickup · consignment shown as BORROW&apos;s share
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
            {/* Net Take + Estimated Profit — top-line figures, one range selector
                applies to both. */}
            <section className="mt-8">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["today", "Today"],
                    ["week", "This week"],
                    ["month", "This month"],
                    ["custom", "Custom"],
                  ] as [RangePreset, string][]
                ).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setPreset(v)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                      preset === v ? "bg-ink text-cream" : "bg-ink/5 text-ink/60 hover:bg-ink/10"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {preset === "custom" && (
                  <div className="flex items-center gap-1.5 text-[13px] text-ink/50">
                    <input
                      type="date"
                      value={customFrom}
                      max={customTo}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="rounded-lg border border-ink/15 bg-white px-2 py-1"
                    />
                    <span>to</span>
                    <input
                      type="date"
                      value={customTo}
                      max={todayISO()}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="rounded-lg border border-ink/15 bg-white px-2 py-1"
                    />
                  </div>
                )}
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {/* Net Take */}
                <div className="rounded-2xl border-2 border-ink/15 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
                    Everything paid {longDate(data.summary.from)}
                    {data.summary.to !== data.summary.from
                      ? ` – ${longDate(data.summary.to)}`
                      : ""}
                  </p>
                  <p className="mt-1 font-serif text-4xl font-semibold">
                    {money(data.summary.everything_paid)}
                  </p>
                  <p className="mt-1.5 rounded-xl bg-sage/25 px-3 py-2 text-[15px]">
                    BORROW made{" "}
                    <span className="font-semibold">{money(data.summary.borrow_made)}</span>{" "}
                    <span className="text-ink/50">of it (after consignors)</span>
                  </p>
                  <p className="mt-1.5 text-[12px] text-ink/45">
                    Counts every payment collected in this window, including
                    reservations paid now for later pickup. Delivered-only (pieces
                    picked up in this window): {money(data.summary.net_take)}.
                  </p>
                  <button
                    onClick={() => setShowBreakdown((s) => !s)}
                    className="mt-2 text-[13px] text-ink/60 underline underline-offset-2"
                  >
                    {showBreakdown ? "Hide breakdown" : "Show breakdown"}
                  </button>
                  {showBreakdown && (
                    <div className="mt-2 space-y-1 border-t border-ink/10 pt-2 text-[13px] text-ink/60">
                      <BRow label="Rental revenue (incl. extended)" v={data.summary.rental_revenue} />
                      <BRow label="Late fees" v={data.summary.late_fees} />
                      <BRow label="Damage & replacement charges" v={data.summary.damage_replacement} />
                      <BRow label="Missing hanger / bag fees" v={data.summary.missing_item_fees} />
                      <BRow label="Quick charges (misc. fees)" v={data.summary.quick_charges} />
                      <BRow label="Refunds issued" v={-data.summary.refunds} />
                      <BRow label="Store credit granted" v={-data.summary.store_credit} />
                      <BRow label="Consignor payouts" v={-data.summary.consignor_payouts} />
                      <div className="flex justify-between border-t border-ink/10 pt-1 font-medium text-ink/80">
                        <span>Net Take</span>
                        <span>{money(data.summary.net_take)}</span>
                      </div>
                      {data.summary.reserved_prepaid > 0 && (
                        <div className="mt-1 border-t border-dashed border-ink/10 pt-1">
                          <BRow
                            label="+ Reserved (prepaid, not yet picked up)"
                            v={data.summary.reserved_prepaid}
                          />
                          <div className="flex justify-between font-medium text-ink/80">
                            <span>Incl. reservations</span>
                            <span>{money(data.summary.net_take_incl_reserved)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Estimated Profit */}
                <div className="rounded-2xl border-2 border-sage-deep/40 bg-sage/20 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
                    Estimated Profit
                  </p>
                  <p className="mt-1 font-serif text-4xl font-semibold">
                    {money(data.summary.estimated_profit)}
                  </p>
                  <div className="mt-2 space-y-1 border-t border-ink/10 pt-2 text-[13px] text-ink/60">
                    <div className="flex justify-between">
                      <span>Net Take</span>
                      <span>{money(data.summary.net_take)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Logged expenses</span>
                      <span>−{money(data.summary.expenses_total)}</span>
                    </div>
                    {data.summary.sales_tax > 0 && (
                      <div className="mt-1 flex justify-between border-t border-dashed border-ink/10 pt-1 text-ink/55">
                        <span>Sales tax collected (set aside to remit)</span>
                        <span>{money(data.summary.sales_tax)}</span>
                      </div>
                    )}
                    {data.summary.reserved_prepaid > 0 && (
                      <div className="mt-1 border-t border-dashed border-ink/10 pt-1">
                        <div className="flex justify-between">
                          <span>+ Reserved (prepaid)</span>
                          <span>{money(data.summary.reserved_prepaid)}</span>
                        </div>
                        <div className="flex justify-between font-medium text-ink/80">
                          <span>Incl. reservations</span>
                          <span>
                            {money(
                              data.summary.estimated_profit + data.summary.reserved_prepaid
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[12px] text-ink/45">
                    Net Take is what Borrow keeps after paying consignors. Estimated
                    Profit also subtracts logged operating expenses like cleaning,
                    fees, rent, and marketing. Sales tax collected isn&rsquo;t profit
                    &mdash; it&rsquo;s held to remit to the state, so set it aside and
                    keep it out of this number. &ldquo;Incl. reservations&rdquo; adds
                    money already collected for upcoming reservations.
                  </p>
                </div>
              </div>

              <ExpenseLog
                from={range.from}
                to={range.to}
                onChange={() => setRefreshKey((k) => k + 1)}
              />

              <CampaignReport onRecorded={() => setRefreshKey((k) => k + 1)} />
            </section>

            {/* Daily revenue by PAYMENT date — every order paid on the chosen day
                (a reservation paid today counts today even if pickup is later),
                filterable by Reserved / Rented Out / Both. Counts each order once,
                on its payment day, so it's never double-counted at pickup. */}
            {(() => {
              const dp = data.day_paid;
              const dayTotal =
                dayFilter === "reserved"
                  ? dp.reserved_total
                  : dayFilter === "rented"
                    ? dp.rented_total
                    : dp.both_total;
              const showReserved = dayFilter !== "rented";
              const showRented = dayFilter !== "reserved";
              const orders =
                (showReserved ? dp.reserved_count : 0) + (showRented ? dp.rented_count : 0);
              const FILTERS: { key: typeof dayFilter; label: string }[] = [
                { key: "both", label: "Both" },
                { key: "reserved", label: "Reserved" },
                { key: "rented", label: "Rented Out" },
              ];
              return (
                <div className="mt-8 rounded-2xl border border-sage-deep/40 bg-sage/20 p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-ink/45">
                        {dp.date === todayISO() ? "Paid today" : "Paid on this day"}
                      </p>
                      <div className="mt-1 flex items-baseline gap-3">
                        <span className="font-serif text-4xl font-semibold">{money(dayTotal)}</span>
                        <span className="text-sm text-ink/50">
                          {orders} order{orders === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink/55">{longDate(dp.date)}</p>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-ink/45">
                        Pick a day
                      </label>
                      <input
                        type="date"
                        value={day}
                        max={todayISO()}
                        onChange={(e) => setDay(e.target.value || todayISO())}
                        className="rounded-xl border border-ink/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-ink/40"
                      />
                    </div>
                  </div>

                  {/* Status filter */}
                  <div className="mt-3 inline-flex rounded-full border border-ink/10 bg-white p-0.5 text-[13px]">
                    {FILTERS.map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setDayFilter(f.key)}
                        className={`rounded-full px-3.5 py-1.5 transition-colors ${
                          dayFilter === f.key ? "bg-ink text-cream" : "text-ink/60 hover:bg-ink/5"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Breakdown */}
                  <div className="mt-3 space-y-1 border-t border-ink/10 pt-3 text-[13px] text-ink/60">
                    {showReserved && (
                      <div className="flex justify-between">
                        <span>
                          Reserved · paid, pickup later{" "}
                          <span className="text-ink/40">({dp.reserved_count})</span>
                        </span>
                        <span>{money(dp.reserved_rental)}</span>
                      </div>
                    )}
                    {showRented && (
                      <div className="flex justify-between">
                        <span>
                          Rented out · picked up{" "}
                          <span className="text-ink/40">({dp.rented_count})</span>
                        </span>
                        <span>{money(dp.rented_rental)}</span>
                      </div>
                    )}
                    {showRented && dp.late_fees > 0 && (
                      <div className="flex justify-between">
                        <span>Late fees</span>
                        <span>{money(dp.late_fees)}</span>
                      </div>
                    )}
                    {showRented && dp.damage_replacement > 0 && (
                      <div className="flex justify-between">
                        <span>Damage &amp; replacement</span>
                        <span>{money(dp.damage_replacement)}</span>
                      </div>
                    )}
                    {showRented && dp.missing_item_fees > 0 && (
                      <div className="flex justify-between">
                        <span>Missing hanger / bag fees</span>
                        <span>{money(dp.missing_item_fees)}</span>
                      </div>
                    )}
                    {showRented && dp.refunds > 0 && (
                      <div className="flex justify-between text-blush-deep">
                        <span>Refunds issued</span>
                        <span>−{money(dp.refunds)}</span>
                      </div>
                    )}
                    {showRented && dp.store_credit > 0 && (
                      <div className="flex justify-between text-blush-deep">
                        <span>Store credit granted</span>
                        <span>−{money(dp.store_credit)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-ink/10 pt-1 font-medium text-ink/80">
                      <span>
                        {dayFilter === "reserved"
                          ? "Reserved total"
                          : dayFilter === "rented"
                            ? "Rented-out total"
                            : "Total paid"}
                      </span>
                      <span>{money(dayTotal)}</span>
                    </div>
                    <p className="pt-0.5 text-[11px] text-ink/40">
                      Sales tax is excluded from this total — it&rsquo;s charged on
                      top and isn&rsquo;t your earnings.
                    </p>
                    {dp.sales_tax > 0 && (
                      <div className="flex justify-between border-t border-dashed border-ink/10 pt-1 text-[13px] text-ink/50">
                        <span>Sales tax collected (set aside to remit)</span>
                        <span>{money(dp.sales_tax)}</span>
                      </div>
                    )}
                    {dayFilter === "both" && (dp.reserved_total > 0 || dp.rented_total > 0) && (
                      <div className="flex justify-between pt-0.5 text-[12px] text-ink/45">
                        <span>
                          Reserved {money(dp.reserved_total)} · Rented out{" "}
                          {money(dp.rented_total)}
                        </span>
                        <span />
                      </div>
                    )}
                    {dayTotal === 0 && dp.reserved_rental === 0 && dp.rented_rental === 0 && (
                      <p className="text-ink/45">No orders paid on this day.</p>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <PeriodCard title="This week" p={data.week} />
              <PeriodCard title="This month" p={data.month} />
            </div>
            <p className="mt-3 text-right text-sm text-ink/50">
              All time: {money(data.all_time.total)} across{" "}
              {data.all_time.rentals} rentals
            </p>

            {/* Reserved & prepaid — money already collected for reservations not
                yet picked up (online + in-store future bookings). Kept separate
                from realized revenue above, since it isn't counted until pickup
                and can still refund on cancellation. */}
            {data.reserved_prepaid && data.reserved_prepaid.count > 0 && (
              <div className="mt-6 rounded-2xl border border-lavender-deep/40 bg-lavender/25 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-medium">Reserved · prepaid</h2>
                  <span className="font-serif text-2xl font-semibold">
                    {money(data.reserved_prepaid.amount)}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-ink/60">
                  Already collected for {data.reserved_prepaid.count} reservation
                  {data.reserved_prepaid.count === 1 ? "" : "s"} not yet picked up
                  ({money(data.reserved_prepaid.online_amount)} online ·{" "}
                  {money(data.reserved_prepaid.instore_amount)} in-store). This
                  isn&apos;t in the revenue above yet — it counts when each piece
                  is picked up, and refunds if a reservation is cancelled.
                </p>
              </div>
            )}

            <h2 className="mt-10 text-2xl font-medium">Piece performance</h2>
            <p className="mt-1 text-sm text-ink/50">
              Ranked by what BORROW has made on each piece (your share after
              consignors). Owned pieces break even around 5 rentals — the bar
              tracks your earnings against what you paid.
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

const EXP_CATS = ["cleaning", "stripe_fees", "rent", "marketing", "supplies", "loan_interest", "donation", "other"];

/** Give-back campaign report: tagged orders, rental total, donation owed, CSV,
 *  and one-tap recording of the donation as a Borrow expense. */
function CampaignReport({ onRecorded }: { onRecorded: () => void }) {
  const [code, setCode] = useState("FIGHT");
  const [from, setFrom] = useState("2026-10-30");
  const [to, setTo] = useState("2026-10-30");
  const [rep, setRep] = useState<{
    code: string; organization: string; donation_rate: number;
    order_count: number; rental_total: number; donation_owed: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const run = useCallback(async () => {
    setBusy(true); setMsg(""); setRep(null);
    try {
      const qs = new URLSearchParams({ code: code.trim().toUpperCase(), from, to });
      const res = await fetch(`/api/campaigns/report?${qs}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) setRep(d);
      else setMsg(d.error || "Couldn't run the report.");
    } catch { setMsg("Couldn't reach the studio."); }
    finally { setBusy(false); }
  }, [code, from, to]);

  async function recordDonation() {
    if (!rep || rep.donation_owed <= 0) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "donation",
          amount: rep.donation_owed,
          incurred_on: to,
          note: `Charitable donation - ${rep.organization} (${rep.code})`,
        }),
      });
      if (res.ok) { setMsg(`Recorded $${rep.donation_owed.toFixed(2)} donation as an expense.`); onRecorded(); }
      else { const d = await res.json().catch(() => ({})); setMsg(d.error || "Couldn't record."); }
    } catch { setMsg("Couldn't reach the studio."); }
    finally { setBusy(false); }
  }

  const csvHref = `/api/campaigns/report?${new URLSearchParams({ code: code.trim().toUpperCase(), from, to, format: "csv" })}`;
  const inp = "rounded-xl border border-ink/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-ink/40";

  return (
    <div className="mt-6 rounded-2xl border border-ink/10 bg-butter/20 p-4">
      <h3 className="text-[15px] font-medium">Give-back campaign report</h3>
      <p className="mt-0.5 text-[12px] text-ink/50">
        Tagged orders in the range (rental price only, excluding tax/fees, cancelled &amp; refunded orders) and the donation owed.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div><label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">Code</label>
          <input className={`${inp} w-28 uppercase`} value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">From</label>
          <input type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">To</label>
          <input type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button onClick={run} disabled={busy} className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40">
          {busy ? "…" : "Run report"}
        </button>
      </div>
      {msg && <p className="mt-2 text-[13px] text-ink/60">{msg}</p>}
      {rep && (
        <div className="mt-3 rounded-xl bg-white p-3.5 text-[14px]">
          <div className="flex justify-between"><span className="text-ink/60">Tagged orders</span><span className="font-medium">{rep.order_count}</span></div>
          <div className="mt-1 flex justify-between"><span className="text-ink/60">Rental total (excl. fees &amp; tax)</span><span className="font-medium">${rep.rental_total.toFixed(2)}</span></div>
          <div className="mt-1 flex justify-between border-t border-ink/10 pt-1.5"><span className="font-medium">Donation owed ({rep.donation_rate}%) → {rep.organization}</span><span className="font-serif text-lg font-semibold">${rep.donation_owed.toFixed(2)}</span></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={csvHref} className="rounded-full border border-ink/15 px-4 py-1.5 text-[13px] text-ink/70">Export CSV</a>
            <button onClick={recordDonation} disabled={busy || rep.donation_owed <= 0} className="rounded-full bg-sage-deep px-4 py-1.5 text-[13px] text-cream disabled:opacity-40">
              Record donation as expense
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpenseLog({ from, to, onChange }: { from: string; to: string; onChange: () => void }) {
  const [entries, setEntries] = useState<ExpenseEntry[] | null>(null);
  const [totals, setTotals] = useState<{ by_category: Record<string, number>; total: number } | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [fDate, setFDate] = useState(todayISO());
  const [fCat, setFCat] = useState("rent");
  const [fAmt, setFAmt] = useState("");
  const [fNote, setFNote] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ from, to });
    if (filter) qs.set("category", filter);
    try {
      const res = await fetch(`/api/expenses?${qs}`);
      if (res.ok) {
        const d = await res.json();
        setEntries(d.entries);
        setTotals(d.totals);
      }
    } catch {
      /* keep prior */
    }
  }, [from, to, filter]);
  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setFormOpen(false);
    setEditId(null);
    setFDate(todayISO());
    setFCat("rent");
    setFAmt("");
    setFNote("");
  }

  async function save() {
    const amount = Number(fAmt);
    if (!(amount > 0)) {
      setMsg("Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    setMsg("");
    const body = JSON.stringify({ incurred_on: fDate, category: fCat, amount, note: fNote.trim() || null });
    const res = await fetch(editId ? `/api/expenses/${editId}` : "/api/expenses", {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error || "Couldn't save.");
      return;
    }
    resetForm();
    await load();
    onChange();
  }

  function startEdit(e: ExpenseEntry) {
    setEditId(Number(e.id.slice(1)));
    setFDate(e.incurred_on);
    setFCat(e.category);
    setFAmt(String(e.amount));
    setFNote(e.note ?? "");
    setFormOpen(true);
  }

  async function del(e: ExpenseEntry) {
    if (!window.confirm("Delete this expense?")) return;
    await fetch(`/api/expenses/${e.id.slice(1)}`, { method: "DELETE" });
    await load();
    onChange();
  }

  async function syncFees() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/finances/sync-fees", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? `Stripe fees updated (${d.filled ?? 0} added).` : "Couldn't refresh fees.");
    } catch {
      setMsg("Couldn't refresh fees.");
    }
    setBusy(false);
    await load();
    onChange();
  }

  return (
    <div className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-medium">
          Expenses{totals ? <span className="text-ink/40"> · {money(totals.total)}</span> : null}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={syncFees}
            disabled={busy}
            className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[13px] text-ink/60 disabled:opacity-40"
          >
            Refresh Stripe fees
          </button>
          <button
            onClick={() => (formOpen ? resetForm() : setFormOpen(true))}
            className="rounded-full bg-ink px-4 py-1.5 text-[13px] text-cream"
          >
            {formOpen ? "Close" : "Add expense"}
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-[12px] text-ink/45">
        Cleaning and Stripe fees fill in automatically. Add rent, marketing, loan
        interest, supplies, and anything else yourself.
      </p>

      {formOpen && (
        <div className="mt-3 grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-[auto_1fr_auto_2fr_auto]">
          <input type="date" value={fDate} max={todayISO()} onChange={(e) => setFDate(e.target.value)} className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[14px]" />
          <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[14px]">
            {EXP_CATS.map((c) => (
              <option key={c} value={c}>{CAT_LABEL[c]}</option>
            ))}
          </select>
          <input inputMode="decimal" placeholder="$0" value={fAmt} onChange={(e) => setFAmt(e.target.value)} className="w-24 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[14px]" />
          <input placeholder="Note (optional)" value={fNote} onChange={(e) => setFNote(e.target.value)} className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[14px]" />
          <button onClick={save} disabled={busy} className="rounded-lg bg-ink px-4 py-1.5 text-[14px] text-cream disabled:opacity-40">
            {editId ? "Save" : "Add"}
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-[13px] text-blush-deep">{msg}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button onClick={() => setFilter("")} className={`rounded-full px-3 py-1 text-[12px] ${filter === "" ? "bg-ink text-cream" : "bg-ink/5 text-ink/55"}`}>All</button>
        {EXP_CATS.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={`rounded-full px-3 py-1 text-[12px] ${filter === c ? "bg-ink text-cream" : "bg-ink/5 text-ink/55"}`}>
            {CAT_LABEL[c]}
            {totals?.by_category?.[c] ? ` · ${money(totals.by_category[c])}` : ""}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        {!entries ? (
          <p className="text-[13px] text-ink/40">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="rounded-xl bg-white/70 p-3 text-[13px] text-ink/45">No expenses logged in this range.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-xl bg-white/70 px-3.5 py-2.5 text-[14px]">
              <span className="w-20 shrink-0 text-[12px] text-ink/45">{fmtDay(e.incurred_on)}</span>
              <span className="w-32 shrink-0 font-medium">{CAT_LABEL[e.category] ?? e.category}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink/50">{e.note}</span>
              <span className="shrink-0 font-medium">{money(e.amount)}</span>
              {e.editable ? (
                <span className="flex shrink-0 gap-1.5">
                  <button onClick={() => startEdit(e)} className="text-[12px] text-ink/45 underline">Edit</button>
                  <button onClick={() => del(e)} className="text-[12px] text-blush-deep underline">Delete</button>
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink/40">auto</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
