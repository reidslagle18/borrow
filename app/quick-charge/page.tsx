"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";

type TerminalReader = {
  id: string;
  label: string | null;
  device_type: string;
  status: string;
  location: string | null;
  location_name: string | null;
};

type Customer = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
};

type QuickCharge = {
  id: number;
  amount: number | string;
  note: string | null;
  status: "pending" | "succeeded" | "failed" | "canceled";
  person_name: string | null;
  person_phone: string | null;
  customer_name: string | null;
  created_at: string;
};

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function QuickChargePage() {
  const [amount, setAmount] = useState("16");
  const [note, setNote] = useState("");

  // Attach-to-a-person (all optional). Either pick an existing customer, or type
  // a name + phone on the spot — the latter never creates a customer record.
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [personQuery, setPersonQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  // Live readers from Stripe (never a stored id).
  const [readers, setReaders] = useState<TerminalReader[] | null>(null);
  const [readerId, setReaderId] = useState("");

  const [tap, setTap] = useState<{
    status: "waiting" | "error";
    id: number;
    piId: string | null;
    message?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [charges, setCharges] = useState<QuickCharge[]>([]);
  const chargedReaderRef = useRef<string>("");

  async function loadLog() {
    try {
      const r = await fetch("/api/quick-charge");
      const d = await r.json().catch(() => ({}));
      if (r.ok) setCharges(d.charges || []);
    } catch {
      /* keep whatever we have */
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [cr, rd] = await Promise.all([
          fetch("/api/customers"),
          fetch("/api/stripe/terminal/readers"),
        ]);
        if (cr.ok) setCustomers(await cr.json());
        if (rd.ok) {
          const list: TerminalReader[] = (await rd.json()).readers || [];
          setReaders(list);
          if (list.length === 1) setReaderId(list[0].id);
        } else {
          setReaders([]);
        }
      } catch {
        setReaders([]);
      }
      loadLog();
    })();
  }, []);

  const matches = useMemo(() => {
    const q = personQuery.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    return customers
      .filter((c) => {
        const name = c.name.toLowerCase();
        const phone = (c.phone || "").replace(/\D/g, "");
        return name.includes(q) || (digits.length >= 3 && phone.includes(digits));
      })
      .slice(0, 6);
  }, [personQuery, customers]);

  const needsReaderChoice = (readers?.length ?? 0) > 1 && !readerId;
  const amt = Math.round(Number(amount) * 100) / 100;
  const canCharge = amt > 0 && !needsReaderChoice && !tap;

  function selectCustomer(c: Customer) {
    setSelected(c);
    setPersonQuery("");
    setManualName("");
    setManualPhone("");
  }

  function resetForm() {
    setAmount("16");
    setNote("");
    setSelected(null);
    setPersonQuery("");
    setManualName("");
    setManualPhone("");
  }

  async function startCharge() {
    setError("");
    if (!(amt > 0)) return setError("Enter a positive amount.");
    setTap({ status: "waiting", id: 0, piId: null });
    try {
      const res = await fetch("/api/quick-charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          note: note.trim() || undefined,
          reader_id: readerId || undefined,
          customer_id: selected?.id,
          person_name: selected ? undefined : manualName.trim() || undefined,
          person_phone: selected ? undefined : manualPhone.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.code === "multiple_readers" && Array.isArray(d.readers)) {
          setReaders(d.readers);
          setReaderId("");
        }
        setTap(null);
        return setError(d.error || "Couldn't start the reader.");
      }
      chargedReaderRef.current = d.reader_id || readerId;
      setTap({ status: "waiting", id: d.id, piId: d.payment_intent_id });
      pollTap(d.id, d.payment_intent_id, 0, chargedReaderRef.current);
    } catch {
      setTap({ status: "error", id: 0, piId: null, message: "Couldn't reach the reader." });
    }
  }

  async function finalize(id: number, status: "succeeded" | "failed" | "canceled", piId: string | null) {
    await fetch("/api/quick-charge", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, payment_intent_id: piId }),
    }).catch(() => {});
    loadLog();
  }

  async function pollTap(id: number, piId: string, attempt: number, reader: string) {
    const MAX = 45; // ~90s at 2s intervals
    try {
      const pr = await fetch("/api/stripe/terminal/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_intent_id: piId, reader_id: reader || undefined }),
      });
      const pd = await pr.json().catch(() => ({}));
      if (pd.status === "succeeded") {
        await finalize(id, "succeeded", piId);
        setTap(null);
        resetForm();
        return;
      }
      if (pd.status === "canceled") {
        await finalize(id, "canceled", piId);
        return setTap({ status: "error", id, piId, message: "Payment canceled on the reader." });
      }
      if (pd.status === "declined") {
        await finalize(id, "failed", piId);
        return setTap({ status: "error", id, piId, message: "Card was declined — try again or use another card." });
      }
      if (pd.status === "failed") {
        await finalize(id, "failed", piId);
        return setTap({ status: "error", id, piId, message: "Payment wasn't collected." });
      }
      if (attempt >= MAX) {
        return setTap({ status: "error", id, piId, message: "Timed out waiting for the tap." });
      }
      setTimeout(() => pollTap(id, piId, attempt + 1, reader), 2000);
    } catch {
      if (attempt >= MAX) {
        return setTap({ status: "error", id, piId, message: "Lost connection to the reader." });
      }
      setTimeout(() => pollTap(id, piId, attempt + 1, reader), 2000);
    }
  }

  async function cancelTap() {
    const t = tap;
    if (!t) return;
    await fetch("/api/stripe/terminal/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reader_id: chargedReaderRef.current || readerId,
        payment_intent_id: t.piId,
      }),
    }).catch(() => {});
    if (t.id) await finalize(t.id, "canceled", t.piId);
    setTap({ status: "error", id: t.id, piId: t.piId, message: "Canceled. Charge again when ready." });
  }

  const personLabel = (c: QuickCharge) =>
    c.customer_name || c.person_name || null;

  const STATUS_STYLE: Record<QuickCharge["status"], string> = {
    succeeded: "bg-sage text-ink/80",
    pending: "bg-butter text-ink/70",
    failed: "bg-blush text-ink/80",
    canceled: "bg-ink/10 text-ink/60",
  };
  const STATUS_LABEL: Record<QuickCharge["status"], string> = {
    succeeded: "Paid",
    pending: "Pending",
    failed: "Failed",
    canceled: "Canceled",
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Quick Charge</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Charge someone on the spot with the reader — a cleaning fee or any
          one-off. Not tied to a piece, an order, or a consignor&apos;s earnings.
        </p>

        {/* The form */}
        <div className="mt-6 space-y-5 rounded-3xl border border-ink/10 bg-white p-5 md:p-7">
          {/* Amount */}
          <div>
            <label className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink/45">
              Amount
            </label>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-serif text-3xl text-ink/50">$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="w-40 rounded-2xl border border-ink/15 bg-cream/40 px-4 py-2.5 font-serif text-3xl outline-none focus:border-ink/40"
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink/45">
              Label / note <span className="normal-case text-ink/35">(optional)</span>
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Cleaning fee — Emmie R."
              className="mt-2 w-full rounded-2xl border border-ink/15 bg-cream/40 px-4 py-2.5 text-[15px] outline-none focus:border-ink/40"
            />
          </div>

          {/* Attach to a person */}
          <div>
            <label className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink/45">
              Who&apos;s being charged <span className="normal-case text-ink/35">(optional)</span>
            </label>

            {selected ? (
              <div className="mt-2 flex items-center justify-between rounded-2xl bg-lavender/30 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{selected.name}</p>
                  {selected.phone && (
                    <p className="text-[13px] text-ink/55">{selected.phone}</p>
                  )}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="shrink-0 rounded-full px-3 py-1 text-sm text-ink/55 hover:bg-white"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={personQuery}
                  onChange={(e) => setPersonQuery(e.target.value)}
                  placeholder="Search a customer by name or phone…"
                  className="mt-2 w-full rounded-2xl border border-ink/15 bg-cream/40 px-4 py-2.5 text-[15px] outline-none focus:border-ink/40"
                />
                {matches.length > 0 && (
                  <div className="mt-1.5 overflow-hidden rounded-2xl border border-ink/10">
                    {matches.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectCustomer(c)}
                        className="flex w-full items-center justify-between border-b border-ink/5 bg-white px-4 py-2.5 text-left last:border-0 hover:bg-cream"
                      >
                        <span className="truncate">{c.name}</span>
                        {c.phone && <span className="ml-3 shrink-0 text-[13px] text-ink/50">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}

                {/* Quick entry — not in the system */}
                <p className="mt-3 text-[12px] text-ink/45">
                  Not in the system? Jot down who it was — this won&apos;t create a record.
                </p>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Name"
                    className="w-full rounded-2xl border border-ink/15 bg-cream/40 px-4 py-2.5 text-[15px] outline-none focus:border-ink/40"
                  />
                  <input
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="Phone"
                    inputMode="tel"
                    className="w-full rounded-2xl border border-ink/15 bg-cream/40 px-4 py-2.5 text-[15px] outline-none focus:border-ink/40"
                  />
                </div>
              </>
            )}
          </div>

          {/* Reader choice, only if more than one */}
          {(readers?.length ?? 0) > 1 && (
            <div>
              <label className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink/45">
                Reader
              </label>
              <select
                value={readerId}
                onChange={(e) => setReaderId(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-ink/15 bg-cream/40 px-4 py-2.5 text-[15px] outline-none focus:border-ink/40"
              >
                <option value="">Pick a reader…</option>
                {readers!.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label || r.device_type}
                    {r.location_name ? ` · ${r.location_name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {readers?.length === 0 && (
            <p className="rounded-2xl bg-butter/50 px-4 py-3 text-[13px] text-ink/70">
              No reader is connected in Stripe. Connect the S700 under Terminal →
              Readers to take a payment.
            </p>
          )}

          {error && <p className="text-sm text-blush-deep">{error}</p>}

          <button
            onClick={startCharge}
            disabled={!canCharge}
            className="w-full rounded-full bg-ink py-3.5 text-[15px] font-medium text-cream transition-opacity disabled:opacity-40"
          >
            Charge {amt > 0 ? money(amt) : ""}
          </button>
        </div>

        {/* Running log */}
        <div className="mt-9">
          <h2 className="font-serif text-2xl font-medium">Recent quick charges</h2>
          {charges.length === 0 ? (
            <p className="mt-2 text-sm text-ink/45">Nothing yet.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-ink/10 bg-white">
              {charges.map((c) => {
                const who = personLabel(c);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 border-b border-ink/5 px-4 py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[15px]">
                        <span className="font-medium">{money(Number(c.amount))}</span>
                        {c.note ? <span className="text-ink/60"> · {c.note}</span> : ""}
                      </p>
                      <p className="text-[12px] text-ink/45">
                        {fmtWhen(c.created_at)}
                        {who ? ` · ${who}` : ""}
                        {!c.customer_name && c.person_phone ? ` · ${c.person_phone}` : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${STATUS_STYLE[c.status]}`}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tap overlay */}
      {tap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-cream p-7 text-center">
            {tap.status === "waiting" ? (
              <>
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
                <h3 className="font-serif text-2xl font-medium">Tap or insert card</h3>
                <p className="mt-1.5 text-sm text-ink/55">
                  Charging {money(amt)} on the reader now.
                </p>
                <button
                  onClick={cancelTap}
                  className="mt-6 w-full rounded-full border border-ink/15 py-3 text-[15px] text-ink/70 hover:bg-white"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <h3 className="font-serif text-2xl font-medium">Not collected</h3>
                <p className="mt-1.5 text-sm text-ink/60">{tap.message}</p>
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={() => setTap(null)}
                    className="flex-1 rounded-full border border-ink/15 py-3 text-[15px] text-ink/70 hover:bg-white"
                  >
                    Close
                  </button>
                  <button
                    onClick={startCharge}
                    className="flex-1 rounded-full bg-ink py-3 text-[15px] text-cream"
                  >
                    Try again
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
