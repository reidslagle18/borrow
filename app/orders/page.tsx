"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { fmtShort, dateOnly } from "@/lib/dates";

type OrderItem = {
  item_id: string;
  barcode: string | null;
  title: string; // display name (custom name, else brand)
  brand: string;
  description: string | null;
  photo_url: string | null;
};

type Order = {
  order_key: string;
  display_id: number;
  transaction_id: number | null;
  source: "online" | "in_store";
  customer_name: string | null;
  piece_count: number;
  total: string | number;
  store_credit_applied: string | number;
  payment_method: string;
  payment_status: string;
  payment_ref: string | null;
  refund_amount: string | number;
  refunded_at: string | null;
  created_at: string;
  start_date: string;
  due_date: string;
  items: OrderItem[];
  order_status: "reserved" | "active" | "completed" | "cancelled";
  refundable: boolean;
  campaign_code: string | null;
};

function money(n: number | string): string {
  const v = Number(n);
  return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
}

function Thumb({ url, title }: { url: string | null; title: string }) {
  return (
    <div className="h-11 w-8 shrink-0 overflow-hidden rounded-md bg-lavender/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
          {(title || "?").charAt(0)}
        </div>
      )}
    </div>
  );
}

// Order lifecycle status (from the rentals): the main tag on each order.
const LIFECYCLE: Record<string, { label: string; cls: string }> = {
  reserved: { label: "Reserved", cls: "bg-butter" },
  active: { label: "Rented Out", cls: "bg-sage" },
  completed: { label: "Returned", cls: "bg-lavender" },
  cancelled: { label: "Cancelled", cls: "bg-ink/10 text-ink/50" },
};

// Payment state, shown as a smaller secondary note.
const PAYMENT: Record<string, string> = {
  collected: "Paid",
  pending: "Payment pending",
  refunded: "Refunded",
  void: "Voided",
};

type SourceFilter = "all" | "online" | "in_store";
type StatusFilter = "all" | "reserved" | "active" | "completed" | "cancelled";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [loadError, setLoadError] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [offerCode, setOfferCode] = useState<string | null>(null); // campaign tag offered for manual add
  const [tagBusy, setTagBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/orders");
      if (!res.ok) throw new Error(`orders ${res.status}`);
      setOrders((await res.json()).orders);
    } catch {
      setLoadError("Couldn't load orders — refresh to try again.");
    }
  }
  useEffect(() => {
    load();
    // The campaign code to offer for manually tagging an order (prefer active).
    fetch("/api/campaigns")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = d?.campaigns ?? [];
        const active = list.find((c: { active: boolean }) => c.active) ?? list[0];
        if (active?.code) setOfferCode(active.code);
      })
      .catch(() => {});
  }, []);

  async function tagOrder(o: Order, action: "add" | "remove") {
    setTagBusy(o.order_key);
    setMsg("");
    try {
      const res = await fetch("/api/orders/tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_key: o.order_key, code: offerCode, action }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) await load();
      else setMsg(d.error || "Couldn't update the tag.");
    } catch {
      setMsg("Couldn't reach the studio — try again.");
    } finally {
      setTagBusy(null);
    }
  }

  async function refund(transactionId: number) {
    setBusyId(transactionId);
    setMsg("");
    try {
      const res = await fetch(`/api/transactions/${transactionId}/refund`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(
          `Order #${transactionId} refunded${d.amount ? ` (${money(d.amount)})` : ""}. The piece is freed.`
        );
        await load();
      } else {
        setMsg(d.error || "Couldn't refund — try again.");
      }
    } catch {
      setMsg("Couldn't reach the studio — check your connection and try again.");
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  const filtered = useMemo(() => {
    if (!orders) return null;
    return orders.filter(
      (o) =>
        (sourceFilter === "all" || o.source === sourceFilter) &&
        (statusFilter === "all" || o.order_status === statusFilter)
    );
  }, [orders, sourceFilter, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: 0, online: 0, in_store: 0 };
    for (const o of orders ?? []) {
      c.all++;
      if (o.source === "online") c.online++;
      else c.in_store++;
    }
    return c;
  }, [orders]);

  const pill = (active: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
      active
        ? "border-ink bg-ink text-cream"
        : "border-ink/15 bg-white text-ink/60 hover:border-ink/35"
    }`;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Orders</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Every order in one place — online reservations and in-store checkouts,
          newest first.
        </p>

        {/* Source filter */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[12px] uppercase tracking-[0.15em] text-ink/45">
            Source
          </span>
          <button className={pill(sourceFilter === "all")} onClick={() => setSourceFilter("all")}>
            All{orders ? ` (${counts.all})` : ""}
          </button>
          <button className={pill(sourceFilter === "online")} onClick={() => setSourceFilter("online")}>
            Online{orders ? ` (${counts.online})` : ""}
          </button>
          <button className={pill(sourceFilter === "in_store")} onClick={() => setSourceFilter("in_store")}>
            In-Store{orders ? ` (${counts.in_store})` : ""}
          </button>
        </div>
        {/* Status filter */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px] uppercase tracking-[0.15em] text-ink/45">
            Status
          </span>
          {(
            [
              ["all", "All"],
              ["reserved", "Reserved"],
              ["active", "Rented Out"],
              ["completed", "Returned"],
              ["cancelled", "Cancelled"],
            ] as [StatusFilter, string][]
          ).map(([v, label]) => (
            <button key={v} className={pill(statusFilter === v)} onClick={() => setStatusFilter(v)}>
              {label}
            </button>
          ))}
        </div>

        {msg && (
          <p className="mt-5 rounded-2xl bg-sage/25 px-4 py-3 text-sm text-ink/70">{msg}</p>
        )}

        <div className="mt-6 space-y-2">
          {loadError && orders === null ? (
            <p className="mt-10 text-center text-ink/50">{loadError}</p>
          ) : filtered === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-ink/5" />
            ))
          ) : filtered.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink/45">
              No orders match this filter.
            </p>
          ) : (
            filtered.map((o) => {
              const life = LIFECYCLE[o.order_status] ?? LIFECYCLE.reserved;
              const isOnline = o.source === "online";
              return (
                <div key={o.order_key} className="rounded-2xl bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
                        <span className="font-medium">
                          {o.customer_name || "Walk-in"}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isOnline ? "bg-blush/50 text-ink" : "bg-lavender/70 text-ink"
                          }`}
                        >
                          {isOnline ? "Online" : "In-Store"}
                        </span>
                        {o.campaign_code && (
                          <span className="rounded-full bg-sage/40 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sage-deep">
                            {o.campaign_code}
                          </span>
                        )}
                        <span className="text-ink/40">
                          #{o.display_id} · {fmtShort(dateOnly(o.created_at))}
                        </span>
                      </p>

                      {o.items && o.items.length > 0 ? (
                        <div className="mt-2 space-y-1.5">
                          {o.items.map((it, idx) => {
                            const sub = [
                              it.title !== it.brand ? it.brand : null,
                              it.description,
                            ]
                              .filter(Boolean)
                              .join(" · ");
                            return (
                              <div key={it.item_id + "-" + idx} className="flex items-center gap-2.5">
                                <Thumb url={it.photo_url} title={it.title} />
                                <div className="min-w-0">
                                  <p className="truncate text-[14px] font-medium">{it.title}</p>
                                  {sub && (
                                    <p className="truncate text-[12px] text-ink/45">{sub}</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-0.5 truncate text-[13px] text-ink/55">
                          {o.piece_count} piece{o.piece_count === 1 ? "" : "s"}
                        </p>
                      )}

                      <p className="mt-2 text-[12px] text-ink/50">
                        Pickup {fmtShort(dateOnly(o.start_date))} · Due{" "}
                        {fmtShort(dateOnly(o.due_date))}
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink/40">
                        {PAYMENT[o.payment_status] ?? o.payment_status}
                        {isOnline
                          ? " · online"
                          : o.payment_method === "terminal"
                            ? " · card reader"
                            : o.payment_method
                              ? ` · ${o.payment_method}`
                              : ""}
                        {o.payment_status === "refunded" && o.refunded_at
                          ? ` · refunded ${money(o.refund_amount)} on ${fmtShort(dateOnly(o.refunded_at))}`
                          : ""}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-[15px] font-medium">{money(o.total)}</p>
                      <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] ${life.cls}`}>
                        {life.label}
                      </span>
                    </div>
                  </div>

                  {o.refundable && o.transaction_id != null && (
                    <div className="mt-3 flex justify-end">
                      {confirmId === o.transaction_id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-ink/60">
                            Refund {money(o.total)} & free the piece?
                          </span>
                          <button
                            onClick={() => refund(o.transaction_id!)}
                            disabled={busyId === o.transaction_id}
                            className="rounded-full border border-blush-deep px-3.5 py-1.5 text-[13px] text-blush-deep disabled:opacity-40"
                          >
                            {busyId === o.transaction_id ? "Refunding…" : "Yes, refund"}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded-full px-3 py-1.5 text-[13px] text-ink/45"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setConfirmId(o.transaction_id);
                            setMsg("");
                          }}
                          className="rounded-full border border-ink/15 px-4 py-1.5 text-[13px] text-ink/70"
                        >
                          Refund
                        </button>
                      )}
                    </div>
                  )}

                  {/* Campaign tag — add/remove after the fact (logged). */}
                  {(o.campaign_code || offerCode) && (
                    <div className="mt-2 flex justify-end">
                      {o.campaign_code ? (
                        <button
                          onClick={() => tagOrder(o, "remove")}
                          disabled={tagBusy === o.order_key}
                          className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[12px] text-ink/55 disabled:opacity-40"
                        >
                          {tagBusy === o.order_key ? "…" : `Remove ${o.campaign_code} tag`}
                        </button>
                      ) : (
                        <button
                          onClick={() => tagOrder(o, "add")}
                          disabled={tagBusy === o.order_key}
                          className="rounded-full border border-sage-deep/40 px-3.5 py-1.5 text-[12px] text-sage-deep disabled:opacity-40"
                        >
                          {tagBusy === o.order_key ? "…" : `+ Tag ${offerCode}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}
