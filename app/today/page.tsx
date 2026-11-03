"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { fmtShort, dateOnly } from "@/lib/dates";

type Rental = {
  id: number;
  item_id: string;
  barcode: string | null;
  brand: string;
  size: string;
  photo_url: string | null;
  customer_name: string | null;
  due_date: string;
};
type Dropoff = {
  id: number;
  slot_time: string;
  name: string;
  phone: string | null;
  item_count: number;
  consignor_id: number | null;
};
type PullReservation = {
  rental_id: number;
  item_id: string;
  barcode: string | null;
  brand: string;
  size: string;
  photo_url: string | null;
  customer_name: string | null;
  reservation_date: string;
  last_safe_date: string;
  days_remaining: number;
  pulled: boolean;
};
type ConsignorPull = {
  request_id: number;
  item_id: string;
  barcode: string | null;
  brand: string;
  size: string;
  photo_url: string | null;
  consignor_name: string;
  hold_start: string;
  hold_end: string | null;
  location: string | null;
  note: string | null;
  pulled: boolean;
};
type Today = {
  pickups: Rental[];
  returns_today: Rental[];
  overdue: Rental[];
  dropoffs: Dropoff[];
  pull_reservations: PullReservation[];
  consignor_pulls: ConsignorPull[];
};
type Notifications = {
  count: number;
  errors?: string[];
  disputed: unknown[];
  pending_approvals: unknown[];
  failed_charges: unknown[];
  overdue: unknown[];
  overdue_reserved: unknown[];
  pull_soon: unknown[];
  deferred_payouts: unknown[];
  sizes_out: unknown[];
  retrievals: unknown[];
  underperformers: unknown[];
  unclaimed_storage: unknown[];
  no_shows: unknown[];
};

function prettyTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function Thumb({ url, brand }: { url: string | null; brand: string }) {
  return (
    <div className="h-12 w-9 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
          {brand.charAt(0)}
        </div>
      )}
    </div>
  );
}

export default function TodayPage() {
  const [data, setData] = useState<Today | null>(null);
  const [notif, setNotif] = useState<Notifications | null>(null);
  const [pullBusy, setPullBusy] = useState<number | null>(null);

  const loadToday = useCallback(async () => {
    const empty: Today = { pickups: [], returns_today: [], overdue: [], dropoffs: [], pull_reservations: [], consignor_pulls: [] };
    try {
      const r = await fetch("/api/today");
      setData(r.ok ? await r.json() : empty);
    } catch {
      setData(empty);
    }
  }, []);

  // Mark a reserved piece pulled (or undo) so the pull list clears what's done
  // and only NEW reservations stand out.
  async function markPulled(rentalId: number, pulled: boolean) {
    setPullBusy(rentalId);
    // Optimistic: flip it right away so it moves out of the to-pull list.
    setData((d) =>
      d
        ? {
            ...d,
            pull_reservations: d.pull_reservations.map((p) =>
              p.rental_id === rentalId ? { ...p, pulled } : p
            ),
          }
        : d
    );
    try {
      await fetch(`/api/rentals/${rentalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pulled ? "pull" : "unpull" }),
      });
      await loadToday();
    } catch {
      await loadToday();
    } finally {
      setPullBusy(null);
    }
  }

  // Mark a consignor hold/retrieval pulled (or undo). Keyed by request_id; we use
  // a negative key in pullBusy so it never collides with a rental_id.
  async function markConsignorPulled(requestId: number, pulled: boolean) {
    setPullBusy(-requestId);
    setData((d) =>
      d
        ? {
            ...d,
            consignor_pulls: d.consignor_pulls.map((p) =>
              p.request_id === requestId ? { ...p, pulled } : p
            ),
          }
        : d
    );
    try {
      await fetch("/api/pull-list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, pulled }),
      });
      await loadToday();
    } catch {
      await loadToday();
    } finally {
      setPullBusy(null);
    }
  }

  // "Needs attention" surface, loaded independently so a failure of either feed
  // never blanks the other. On a failed/transient fetch we KEEP the last good
  // value rather than blanking the panel, and we poll so it stays current.
  const loadNotif = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (r.ok) setNotif(await r.json());
    } catch {
      /* keep the previous value rather than blanking */
    }
  }, []);

  useEffect(() => {
    loadToday();
    loadNotif();
    const t = setInterval(loadNotif, 120_000); // keep it current
    return () => clearInterval(t);
  }, [loadToday, loadNotif]);

  // Actionable-item rows for the Needs-attention panel, each linking to where
  // it's handled. Only groups with items render.
  const attention: { key: string; label: string; href: string }[] = notif
    ? [
        { key: "overdue_reserved", n: notif.overdue_reserved?.length ?? 0, href: "/returns", one: "overdue piece with a reservation waiting", many: "overdue pieces with reservations waiting" },
        { key: "disputed", n: notif.disputed?.length ?? 0, href: "/consignors", one: "disputed replacement value", many: "disputed replacement values" },
        { key: "pending_approvals", n: notif.pending_approvals?.length ?? 0, href: "/consignors", one: "consignor with items to approve", many: "consignors with items to approve" },
        { key: "overdue", n: notif.overdue?.length ?? 0, href: "/returns", one: "overdue return", many: "overdue returns" },
        { key: "retrievals", n: notif.retrievals?.length ?? 0, href: "/retrievals", one: "consignor hold to prep", many: "consignor holds to prep" },
        { key: "pull_soon", n: notif.pull_soon?.length ?? 0, href: "/pull-list", one: "piece to pull for a reservation", many: "pieces to pull for reservations" },
        { key: "deferred_payouts", n: notif.deferred_payouts?.length ?? 0, href: "/consignors", one: "payout waiting on funds", many: "payouts waiting on funds" },
        { key: "sizes_out", n: notif.sizes_out?.length ?? 0, href: "/inventory", one: "size fully rented out", many: "sizes fully rented out" },
        { key: "underperformers", n: notif.underperformers?.length ?? 0, href: "/pickups", one: "underperforming piece to review", many: "underperforming pieces to review" },
        { key: "unclaimed_storage", n: notif.unclaimed_storage?.length ?? 0, href: "/pickups", one: "unclaimed stored piece to decide", many: "unclaimed stored pieces to decide" },
      ]
        .filter((g) => g.n > 0)
        .map((g) => ({ key: g.key, href: g.href, label: `${g.n} ${g.n === 1 ? g.one : g.many}` }))
    : [];

  function RentalRow({ r, overdue }: { r: Rental; overdue?: boolean }) {
    return (
      <Link
        href={`/inventory/${r.barcode || r.item_id}`}
        className={`flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white ${
          overdue ? "bg-blush/25" : "bg-white/70"
        }`}
      >
        <Thumb url={r.photo_url} brand={r.brand} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]">
            <span className="font-medium">{r.customer_name ?? "No customer"}</span>{" "}
            <span className="text-ink/50">· {r.brand}</span>
          </p>
          <p className="truncate text-[13px] text-ink/55">
            {r.barcode || r.item_id} · {r.size}
          </p>
        </div>
        {overdue && (
          <span className="shrink-0 rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">
            overdue
          </span>
        )}
      </Link>
    );
  }

  const pickups = data?.pickups ?? [];
  const returns = data?.returns_today ?? [];
  const overdue = data?.overdue ?? [];
  const dropoffs = data?.dropoffs ?? [];
  // Pull from racks — two groups:
  //   (a) Consignor pulls: holds/retrievals that start today or tomorrow.
  //   (b) Reserved pulls: reserved pieces at/near their Last Safe Rental Date.
  const reservedPulls = data?.pull_reservations ?? [];
  const toPullR = reservedPulls.filter((p) => !p.pulled);
  const donePullsR = reservedPulls.filter((p) => p.pulled);
  const consignorPulls = data?.consignor_pulls ?? [];
  const toPullC = consignorPulls.filter((p) => !p.pulled);
  const donePullsC = consignorPulls.filter((p) => p.pulled);
  const hasAnyPulls =
    toPullR.length + donePullsR.length + toPullC.length + donePullsC.length > 0;
  const toPullCount = toPullR.length + toPullC.length;
  const returnsCount = returns.length + overdue.length;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Today</h1>
        <p className="mt-1.5 text-sm text-ink/50">{todayLabel()}</p>

        {!data ? (
          <div className="mt-8 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            {/* Needs attention — the daily starting point, pinned to the top. */}
            <section className="mt-6 rounded-2xl border-2 border-blush-deep/30 bg-blush/15 p-4">
              <h2 className="text-2xl font-medium">
                Needs attention
                {notif && notif.count > 0 && (
                  <span className="text-blush-deep"> ({notif.count})</span>
                )}
              </h2>
              {notif?.errors && notif.errors.length > 0 && (
                <p className="mt-1 text-[12px] text-blush-deep">
                  Some checks couldn&apos;t run just now ({notif.errors.join(", ")}). Retrying shortly.
                </p>
              )}
              {!notif ? (
                <p className="mt-2 text-[13px] text-ink/40">Checking…</p>
              ) : attention.length === 0 ? (
                <p className="mt-2 rounded-xl bg-white/60 px-4 py-3 text-[15px] text-ink/55">
                  All clear — nothing needs your attention right now.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {attention.map((g) => (
                    <Link
                      key={g.key}
                      href={g.href}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-4 py-2.5 text-[15px] transition-colors hover:bg-white"
                    >
                      <span>{g.label}</span>
                      <span className="shrink-0 text-[13px] text-ink/45">Review →</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <p className="mt-6 rounded-2xl bg-lavender/30 px-4 py-3 text-[15px]">
              <span className="font-medium">{pickups.length}</span> pickup
              {pickups.length === 1 ? "" : "s"} ·{" "}
              <span className="font-medium">{returnsCount}</span> return
              {returnsCount === 1 ? "" : "s"}
              {overdue.length > 0 && (
                <span className="text-blush-deep"> ({overdue.length} overdue)</span>
              )}{" "}
              · <span className="font-medium">{dropoffs.length}</span> drop-off
              {dropoffs.length === 1 ? "" : "s"}
            </p>

            {/* Pull from racks — two groups: consignor pulls (holds/retrievals
                starting today or tomorrow) and reserved pulls (pieces at/near
                their Last Safe Rental Date). Tap Pulled to clear each one. */}
            {hasAnyPulls && (
              <section className="mt-6 rounded-2xl border border-butter-deep/40 bg-butter/25 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-medium">
                    Pull from racks{" "}
                    <span className="text-ink/40">({toPullCount})</span>
                  </h2>
                  <Link href="/pull-list" className="text-[13px] text-ink/45">
                    Full list →
                  </Link>
                </div>
                <p className="mt-0.5 text-[13px] text-ink/55">
                  Pull these into the holding area, then tap Pulled to clear them.
                </p>

                {/* (a) Consignor pulls */}
                {(toPullC.length > 0 || donePullsC.length > 0) && (
                  <div className="mt-3">
                    <p className="text-[11px] uppercase tracking-[0.15em] text-ink/45">
                      Consignor pulls
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {toPullC.length === 0 ? (
                        <p className="rounded-xl bg-white/60 p-3 text-[13px] text-ink/45">
                          All pulled.
                        </p>
                      ) : (
                        toPullC.map((p) => (
                          <div
                            key={p.request_id}
                            className="flex items-center gap-3 rounded-xl bg-white/70 p-3"
                          >
                            <Link
                              href={`/inventory/${p.barcode || p.item_id}`}
                              className="flex min-w-0 flex-1 items-center gap-3"
                            >
                              <Thumb url={p.photo_url} brand={p.brand} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[15px] font-medium">
                                  {p.brand}
                                </p>
                                <p className="truncate text-[13px] text-ink/55">
                                  {p.consignor_name} · hold{" "}
                                  {fmtShort(dateOnly(p.hold_start))}
                                  {p.hold_end && p.hold_end !== p.hold_start
                                    ? `–${fmtShort(dateOnly(p.hold_end))}`
                                    : ""}
                                  {p.location ? ` · ${p.location}` : ""}
                                </p>
                              </div>
                            </Link>
                            <button
                              onClick={() => markConsignorPulled(p.request_id, true)}
                              disabled={pullBusy === -p.request_id}
                              className="shrink-0 rounded-full bg-ink px-3.5 py-2 text-[13px] text-cream disabled:opacity-40"
                            >
                              {pullBusy === -p.request_id ? "…" : "Pulled"}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    {donePullsC.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13px] text-ink/45">
                          Already pulled ({donePullsC.length})
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          {donePullsC.map((p) => (
                            <div
                              key={p.request_id}
                              className="flex items-center gap-3 rounded-xl bg-white/40 p-3 text-ink/55"
                            >
                              <Thumb url={p.photo_url} brand={p.brand} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[15px]">{p.brand}</p>
                                <p className="truncate text-[13px] text-ink/45">
                                  {p.consignor_name} · hold{" "}
                                  {fmtShort(dateOnly(p.hold_start))}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-sage px-2.5 py-1 text-[11px] text-ink">
                                Pulled ✓
                              </span>
                              <button
                                onClick={() => markConsignorPulled(p.request_id, false)}
                                disabled={pullBusy === -p.request_id}
                                className="shrink-0 text-[13px] text-ink/45 underline disabled:opacity-40"
                              >
                                {pullBusy === -p.request_id ? "…" : "Undo"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {/* (b) Reserved pulls */}
                {(toPullR.length > 0 || donePullsR.length > 0) && (
                  <div className="mt-4">
                    <p className="text-[11px] uppercase tracking-[0.15em] text-ink/45">
                      Reserved pulls
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {toPullR.length === 0 ? (
                        <p className="rounded-xl bg-white/60 p-3 text-[13px] text-ink/45">
                          All pulled — anything new will show up here.
                        </p>
                      ) : (
                        toPullR.map((p) => (
                          <div
                            key={p.rental_id}
                            className="flex items-center gap-3 rounded-xl bg-white/70 p-3"
                          >
                            <Link
                              href={`/inventory/${p.barcode || p.item_id}`}
                              className="flex min-w-0 flex-1 items-center gap-3"
                            >
                              <Thumb url={p.photo_url} brand={p.brand} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[15px] font-medium">
                                  {p.brand}
                                </p>
                                <p className="truncate text-[13px] text-ink/55">
                                  Reserved {fmtShort(dateOnly(p.reservation_date))}
                                  {p.customer_name ? ` · ${p.customer_name}` : ""} · safe
                                  until {fmtShort(dateOnly(p.last_safe_date))}
                                </p>
                              </div>
                            </Link>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
                                p.days_remaining <= 0
                                  ? "bg-blush-deep text-cream"
                                  : "bg-butter-deep/70 text-ink"
                              }`}
                            >
                              {p.days_remaining <= 0
                                ? "Pull now"
                                : `${p.days_remaining} day${p.days_remaining === 1 ? "" : "s"} left`}
                            </span>
                            <button
                              onClick={() => markPulled(p.rental_id, true)}
                              disabled={pullBusy === p.rental_id}
                              className="shrink-0 rounded-full bg-ink px-3.5 py-2 text-[13px] text-cream disabled:opacity-40"
                            >
                              {pullBusy === p.rental_id ? "…" : "Pulled"}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    {donePullsR.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13px] text-ink/45">
                          Already pulled ({donePullsR.length})
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          {donePullsR.map((p) => (
                            <div
                              key={p.rental_id}
                              className="flex items-center gap-3 rounded-xl bg-white/40 p-3 text-ink/55"
                            >
                              <Thumb url={p.photo_url} brand={p.brand} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[15px]">{p.brand}</p>
                                <p className="truncate text-[13px] text-ink/45">
                                  Reserved {fmtShort(dateOnly(p.reservation_date))}
                                  {p.customer_name ? ` · ${p.customer_name}` : ""}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-sage px-2.5 py-1 text-[11px] text-ink">
                                Pulled ✓
                              </span>
                              <button
                                onClick={() => markPulled(p.rental_id, false)}
                                disabled={pullBusy === p.rental_id}
                                className="shrink-0 text-[13px] text-ink/45 underline disabled:opacity-40"
                              >
                                {pullBusy === p.rental_id ? "…" : "Undo"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Pickups */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Pickups today <span className="text-ink/40">({pickups.length})</span>
              </h2>
              <div className="mt-3 space-y-2">
                {pickups.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    No pickups scheduled today.
                  </p>
                ) : (
                  pickups.map((r) => <RentalRow key={r.id} r={r} />)
                )}
              </div>
            </section>

            {/* Returns due */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Returns due today{" "}
                <span className="text-ink/40">({returnsCount})</span>
              </h2>
              <div className="mt-3 space-y-2">
                {overdue.map((r) => (
                  <RentalRow key={r.id} r={r} overdue />
                ))}
                {returns.map((r) => (
                  <RentalRow key={r.id} r={r} />
                ))}
                {returnsCount === 0 && (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    Nothing due back today.
                  </p>
                )}
              </div>
            </section>

            {/* Drop-offs */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Drop-off appointments today{" "}
                <span className="text-ink/40">({dropoffs.length})</span>
              </h2>
              <div className="mt-3 space-y-2">
                {dropoffs.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    No drop-offs booked today.
                  </p>
                ) : (
                  dropoffs.map((a) => (
                    <Link
                      key={a.id}
                      href="/dropoff"
                      className="flex items-center gap-3 rounded-2xl bg-white/70 p-3 transition-colors hover:bg-white"
                    >
                      <span className="w-20 shrink-0 text-center font-serif text-lg font-semibold">
                        {prettyTime(a.slot_time)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">
                          {a.name}{" "}
                          <span className="text-ink/50">
                            · {a.item_count} item{a.item_count === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          {a.phone || "no phone"}
                        </p>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
