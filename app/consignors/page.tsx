"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  Item,
  Consignor,
  Payout,
  ConsignorCharge,
  statusLabel,
  ItemStatus,
} from "@/lib/types";
import { fmtShort, dateOnly } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type ConsignorRow = Consignor & {
  piece_count: number;
  active_piece_count: number;
  earned: number;
  paid: number;
  owed: number;
  portal_code?: string | null;
};

type ConsignorDetail = ConsignorRow & {
  items: (Item & { completed_rentals: number; earned: number })[];
  payouts: Payout[];
  charges: ConsignorCharge[];
  cleaning_charges: number;
};

const STATUS_BADGE: Record<ItemStatus, string> = {
  available: "bg-sage",
  reserved: "bg-lavender",
  rented: "bg-blush",
  cleaning: "bg-butter",
  retired: "bg-ink/10 text-ink/60",
};

function money(n: number | string): string {
  const v = Number(n);
  return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
}

function ConsignorForm({
  consignor,
  onClose,
  onSaved,
}: {
  consignor: Consignor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(consignor?.name ?? "");
  const [phone, setPhone] = useState(consignor?.phone ?? "");
  const [email, setEmail] = useState(consignor?.email ?? "");
  const [notes, setNotes] = useState(consignor?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    const res = await fetch(
      consignor ? `/api/consignors/${consignor.id}` : "/api/consignors",
      {
        method: consignor ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          notes: notes.trim(),
        }),
      }
    );
    if (res.ok) {
      onSaved();
    } else {
      setError("Couldn't save — try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-3xl font-medium">
          {consignor ? "Edit consignor" : "New consignor"}
        </h2>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Venmo handle, drop-off habits…" />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-blush-deep">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-full bg-ink px-6 py-3 text-cream disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="rounded-full border border-ink/15 px-5 py-3 text-ink/50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ConsignorDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Venmo");
  const [paySaving, setPaySaving] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [confirmReturn, setConfirmReturn] = useState<string | null>(null);
  const [dryClean, setDryClean] = useState(false);

  async function load() {
    const res = await fetch(`/api/consignors/${id}`);
    if (res.ok) {
      const d = await res.json();
      setDetail(d);
      setPayAmount(d.owed > 0 ? String(d.owed) : "");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function recordPayout() {
    if (!payAmount || Number(payAmount) <= 0) return;
    setPaySaving(true);
    const res = await fetch(`/api/consignors/${id}/payouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(payAmount), method: payMethod }),
    });
    if (res.ok) {
      await load();
      onChanged();
    }
    setPaySaving(false);
  }

  async function returnPiece(itemId: string) {
    setBusyItem(itemId);
    const res = await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return_to_consignor", dry_clean: dryClean }),
    });
    if (res.ok) {
      await load();
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Couldn't return this piece.");
    }
    setBusyItem(null);
    setConfirmReturn(null);
    setDryClean(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {!detail ? (
          <div className="h-40 animate-pulse rounded-2xl bg-ink/5" />
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-medium">{detail.name}</h2>
                <p className="mt-1 text-sm text-ink/55">
                  {[detail.phone, detail.email].filter(Boolean).join(" · ") ||
                    "No contact info"}
                </p>
                {detail.notes && (
                  <p className="mt-1 text-sm text-ink/45">{detail.notes}</p>
                )}
                {detail.portal_code && (
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(
                        `Check on your BORROW pieces anytime: borrow-shop.vercel.app/portal — your access code is ${detail.portal_code}`
                      )
                    }
                    className="mt-2 rounded-full bg-lavender/50 px-3 py-1.5 text-[12px] tracking-wide"
                    title="Tap to copy an invite message"
                  >
                    Portal code: <span className="font-medium">{detail.portal_code}</span> · tap to copy invite
                  </button>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => setEditOpen(true)}
                  className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/60"
                >
                  Edit
                </button>
                <button
                  onClick={onClose}
                  className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Money summary */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white p-3.5 text-center">
                <p className="text-xs uppercase tracking-[0.15em] text-ink/45">Earned (60%)</p>
                <p className="mt-1 font-serif text-2xl font-semibold">{money(detail.earned)}</p>
              </div>
              <div className="rounded-2xl bg-white p-3.5 text-center">
                <p className="text-xs uppercase tracking-[0.15em] text-ink/45">Paid out</p>
                <p className="mt-1 font-serif text-2xl font-semibold">{money(detail.paid)}</p>
              </div>
              <div className={`rounded-2xl p-3.5 text-center ${detail.owed > 0 ? "bg-butter" : "bg-white"}`}>
                <p className="text-xs uppercase tracking-[0.15em] text-ink/45">Owed</p>
                <p className="mt-1 font-serif text-2xl font-semibold">{money(detail.owed)}</p>
              </div>
            </div>
            {detail.cleaning_charges > 0 && (
              <p className="mt-1.5 text-[12px] text-ink/45">
                Includes {money(detail.cleaning_charges)} in opt-in cleaning charges deducted from earnings.
              </p>
            )}

            {/* Record payout */}
            <div className="mt-4 rounded-2xl bg-lavender/25 p-4">
              <p className={labelCls}>Record payout</p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  className="w-28 rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none"
                  placeholder="$"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <select
                  className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none"
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                >
                  {["Venmo", "Zelle", "Cash", "Check", "Other"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <button
                  onClick={recordPayout}
                  disabled={paySaving || !payAmount || Number(payAmount) <= 0}
                  className="rounded-full bg-ink px-5 py-2.5 text-[15px] text-cream disabled:opacity-40"
                >
                  {paySaving ? "Saving…" : "Mark paid"}
                </button>
              </div>
            </div>

            {/* Pieces */}
            <h3 className="mt-6 text-xl font-medium">
              Pieces ({detail.items.length})
            </h3>
            <div className="mt-2 space-y-2">
              {detail.items.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                  No pieces from this consignor yet.
                </p>
              ) : (
                detail.items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                    <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                      {i.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.photo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
                          {i.brand.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">
                        <span className="font-serif font-semibold">{i.brand}</span>{" "}
                        <span className="text-ink/50">{i.id} · {i.size}</span>
                      </p>
                      <p className="truncate text-[13px] text-ink/55">
                        rented {i.completed_rentals}× · earned {money(i.earned)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${STATUS_BADGE[i.status]}`}>
                      {statusLabel(i.status)}
                    </span>
                    {i.status !== "retired" &&
                      (confirmReturn === i.id ? (
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <label className="flex items-center gap-1.5 text-[12px] text-ink/60">
                            <input
                              type="checkbox"
                              checked={dryClean}
                              onChange={(e) => setDryClean(e.target.checked)}
                              className="h-3.5 w-3.5 accent-ink"
                            />
                            Dry clean — consignor opted in (deducts the cleaning fee from earnings)
                          </label>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => returnPiece(i.id)}
                              disabled={busyItem === i.id}
                              className="rounded-full border border-blush-deep px-3 py-1.5 text-[12px] text-blush-deep disabled:opacity-40"
                            >
                              Confirm return
                            </button>
                            <button
                              onClick={() => {
                                setConfirmReturn(null);
                                setDryClean(false);
                              }}
                              className="rounded-full px-3 py-1.5 text-[12px] text-ink/40"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmReturn(i.id)}
                          className="shrink-0 rounded-full border border-ink/15 px-3 py-1.5 text-[12px] text-ink/50"
                        >
                          Return to her
                        </button>
                      ))}
                  </div>
                ))
              )}
            </div>

            {/* Payout history */}
            {detail.payouts.length > 0 && (
              <>
                <h3 className="mt-6 text-xl font-medium">Payout history</h3>
                <div className="mt-2 space-y-1.5">
                  {detail.payouts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-2.5 text-[14px]">
                      <span>
                        {money(p.amount)}
                        {p.method && <span className="text-ink/50"> · {p.method}</span>}
                      </span>
                      <span className="text-ink/45">{fmtShort(dateOnly(p.paid_at))}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Cleaning charges (opt-in) */}
            {detail.charges.length > 0 && (
              <>
                <h3 className="mt-6 text-xl font-medium">Cleaning charges</h3>
                <div className="mt-2 space-y-1.5">
                  {detail.charges.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-2.5 text-[14px]">
                      <span>
                        −{money(c.amount)}
                        <span className="text-ink/50">
                          {" "}· {c.kind === "retrieval" ? "dry clean at retrieval" : "initial clean"}
                        </span>
                      </span>
                      <span className="text-ink/45">{fmtShort(dateOnly(c.charged_on))}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {editOpen && detail && (
        <ConsignorForm
          consignor={detail}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export default function ConsignorsPage() {
  const [consignors, setConsignors] = useState<ConsignorRow[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");

  async function load() {
    const res = await fetch("/api/consignors");
    if (res.ok) setConsignors(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  const list = (consignors ?? []).filter((c) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      c.name.toLowerCase().includes(t) ||
      (c.phone ?? "").replace(/\D/g, "").includes(t.replace(/\D/g, "") || " ")
    );
  });
  const totalOwed = (consignors ?? []).reduce((s, c) => s + c.owed, 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-medium md:text-5xl">Consignors</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              {consignors?.length ?? "…"} consignors
              {totalOwed > 0 && ` · ${money(totalOwed)} owed in payouts`}
            </p>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-transform active:scale-[0.98]"
          >
            + Add consignor
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or phone…"
          className="mt-6 w-full max-w-sm rounded-full border border-ink/15 bg-white px-4.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
        />

        <div className="mt-5 space-y-2">
          {consignors === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))
          ) : list.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink/45">
              {consignors.length === 0
                ? "No consignors yet — add the first one."
                : "No one matches that search."}
            </p>
          ) : (
            list.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left transition-colors hover:bg-white/70"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blush/40 font-serif text-lg italic">
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px]">{c.name}</p>
                  <p className="truncate text-[13px] text-ink/55">
                    {c.active_piece_count} piece{c.active_piece_count === 1 ? "" : "s"} on the rack
                    {c.phone ? ` · ${c.phone}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px]">{money(c.earned)} earned</p>
                  {c.owed > 0 ? (
                    <span className="mt-0.5 inline-block rounded-full bg-butter px-2.5 py-0.5 text-[12px] font-medium">
                      {money(c.owed)} owed
                    </span>
                  ) : (
                    <p className="text-[12px] text-ink/45">paid up</p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {openId !== null && (
        <DetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
      {addOpen && (
        <ConsignorForm
          consignor={null}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            load();
          }}
        />
      )}
    </AppShell>
  );
}
