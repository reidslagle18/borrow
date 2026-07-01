"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { fmtShort, dateOnly } from "@/lib/dates";

type Order = {
  id: number;
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
  pieces: string;
  refundable: boolean;
};

function money(n: number | string): string {
  const v = Number(n);
  return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  collected: { label: "Paid", cls: "bg-sage" },
  pending: { label: "Payment pending", cls: "bg-butter" },
  refunded: { label: "Refunded", cls: "bg-lavender" },
  void: { label: "Voided", cls: "bg-ink/10 text-ink/60" },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch("/api/transactions");
    if (res.ok) setOrders((await res.json()).orders);
  }
  useEffect(() => {
    load();
  }, []);

  async function refund(id: number) {
    setBusyId(id);
    setMsg("");
    const res = await fetch(`/api/transactions/${id}/refund`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`Order #${id} refunded${d.amount ? ` (${money(d.amount)})` : ""}. The piece is freed.`);
      await load();
    } else {
      setMsg(d.error || "Couldn't refund — try again.");
    }
    setBusyId(null);
    setConfirmId(null);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="text-4xl font-medium md:text-5xl">Orders</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          In-person checkouts. Refund a card charge here — it also frees the piece.
        </p>

        {msg && (
          <p className="mt-5 rounded-2xl bg-sage/25 px-4 py-3 text-sm text-ink/70">{msg}</p>
        )}

        <div className="mt-6 space-y-2">
          {orders === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-ink/5" />
            ))
          ) : orders.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink/45">
              No in-person orders yet.
            </p>
          ) : (
            orders.map((o) => {
              const s = STATUS[o.payment_status] ?? STATUS.collected;
              return (
                <div key={o.id} className="rounded-2xl bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px]">
                        <span className="font-medium">
                          {o.customer_name || "Walk-in"}
                        </span>
                        <span className="text-ink/45">
                          {" "}
                          · #{o.id} · {fmtShort(dateOnly(o.created_at))}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-ink/55">
                        {o.pieces || `${o.piece_count} piece${o.piece_count === 1 ? "" : "s"}`}
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink/40">
                        {o.payment_method === "terminal"
                          ? "Card reader"
                          : o.payment_method}
                        {o.payment_status === "refunded" && o.refunded_at
                          ? ` · refunded ${money(o.refund_amount)} on ${fmtShort(dateOnly(o.refunded_at))}`
                          : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[15px] font-medium">{money(o.total)}</p>
                      <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] ${s.cls}`}>
                        {s.label}
                      </span>
                    </div>
                  </div>

                  {o.refundable && (
                    <div className="mt-3 flex justify-end">
                      {confirmId === o.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-ink/60">
                            Refund {money(o.total)} & free the piece?
                          </span>
                          <button
                            onClick={() => refund(o.id)}
                            disabled={busyId === o.id}
                            className="rounded-full border border-blush-deep px-3.5 py-1.5 text-[13px] text-blush-deep disabled:opacity-40"
                          >
                            {busyId === o.id ? "Refunding…" : "Yes, refund"}
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
                            setConfirmId(o.id);
                            setMsg("");
                          }}
                          className="rounded-full border border-ink/15 px-4 py-1.5 text-[13px] text-ink/70"
                        >
                          Refund
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
