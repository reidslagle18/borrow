"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { Customer, Rental, RentalStatus } from "@/lib/types";
import { fmtShort, dateOnly } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type CustomerRow = Customer & { rental_count: number };
type CustomerDetail = Customer & {
  rentals: Rental[];
  spent: number;
  credited_rental_ids: number[];
};

const RENTAL_BADGE: Record<RentalStatus, { label: string; cls: string }> = {
  reserved: { label: "reserved", cls: "bg-lavender" },
  active: { label: "out now", cls: "bg-blush" },
  completed: { label: "returned", cls: "bg-sage" },
  cancelled: { label: "cancelled", cls: "bg-ink/10 text-ink/50" },
};

function money(n: number | string): string {
  const v = Number(n);
  return `$${v % 1 === 0 ? v.toLocaleString() : v.toFixed(2)}`;
}

function FlagBadge({ flag }: { flag: Customer["flag"] }) {
  if (flag === "vip")
    return (
      <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px] font-medium">
        VIP
      </span>
    );
  if (flag === "problem")
    return (
      <span className="rounded-full bg-blush px-2.5 py-0.5 text-[11px] font-medium">
        problem
      </span>
    );
  return null;
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
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [instagram, setInstagram] = useState("");
  const [notes, setNotes] = useState("");
  const [flag, setFlag] = useState<"" | "vip" | "problem">("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch(`/api/customers/${id}`);
    if (res.ok) {
      const d: CustomerDetail = await res.json();
      setDetail(d);
      setName(d.name);
      setPhone(d.phone ?? "");
      setEmail(d.email ?? "");
      setInstagram(d.instagram ?? "");
      setNotes(d.notes ?? "");
      setFlag(d.flag ?? "");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveFlag(next: "" | "vip" | "problem") {
    if (!detail) return;
    setFlag(next);
    await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: detail.name,
        phone: detail.phone,
        email: detail.email,
        instagram: detail.instagram,
        notes: detail.notes,
        flag: next || null,
      }),
    });
    onChanged();
    load();
  }

  async function saveEdit() {
    if (!name.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        instagram: instagram.trim(),
        notes: notes.trim(),
        flag: flag || null,
      }),
    });
    if (res.ok) {
      setEditing(false);
      onChanged();
      await load();
    }
    setSaving(false);
  }

  async function grantPostCredit(rentalId: number) {
    const res = await fetch(`/api/customers/${id}/credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rental_id: rentalId }),
    });
    if (res.ok) {
      onChanged();
      await load();
    }
  }

  const completed =
    detail?.rentals.filter((r) => r.status === "completed").length ?? 0;

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
                <div className="flex items-center gap-2">
                  <h2 className="text-3xl font-medium">{detail.name}</h2>
                  <FlagBadge flag={detail.flag} />
                  {completed >= 2 && (
                    <span className="rounded-full bg-lavender px-2.5 py-0.5 text-[11px] font-medium">
                      repeat
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink/55">
                  {[detail.phone, detail.instagram, detail.email]
                    .filter(Boolean)
                    .join(" · ") || "No contact info"}
                </p>
                {detail.notes && (
                  <p className="mt-1 text-sm text-ink/45">{detail.notes}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => setEditing(!editing)}
                  className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/60"
                >
                  {editing ? "Close edit" : "Edit"}
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

            {editing && (
              <div className="mb-5 space-y-3 rounded-2xl bg-white p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Name *</label>
                    <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Phone</label>
                    <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Instagram</label>
                    <input className={inputCls} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@handle" />
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sizes she loves, sorority, anything useful…" />
                </div>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="rounded-full bg-ink px-5 py-2.5 text-[15px] text-cream disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            )}

            {/* Flag + spend */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-[0.15em] text-ink/45">
                Flag:
              </span>
              {(["", "vip", "problem"] as const).map((f) => (
                <button
                  key={f || "none"}
                  onClick={() => saveFlag(f)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm ${
                    flag === f
                      ? f === "problem"
                        ? "border-blush-deep bg-blush"
                        : f === "vip"
                          ? "border-butter-deep bg-butter"
                          : "border-ink bg-ink text-cream"
                      : "border-ink/15 bg-white text-ink/55"
                  }`}
                >
                  {f === "" ? "none" : f === "vip" ? "VIP" : "problem"}
                </button>
              ))}
              <span className="ml-auto text-sm text-ink/55">
                {money(detail.spent)} lifetime
              </span>
            </div>

            {Number(detail.store_credit) > 0 && (
              <p className="mt-3 rounded-2xl bg-sage/30 px-4 py-2.5 text-sm">
                <span className="font-medium">{money(detail.store_credit)} store credit</span>{" "}
                — applies automatically at their next checkout.
              </p>
            )}

            {/* Rental history */}
            <h3 className="mt-6 text-xl font-medium">
              Rental history ({detail.rentals.length})
            </h3>
            <div className="mt-2 space-y-2">
              {detail.rentals.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                  No rentals yet.
                </p>
              ) : (
                detail.rentals.map((r) => {
                  const badge = RENTAL_BADGE[r.status];
                  return (
                    <div key={r.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                      <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                        {r.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.photo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
                            {r.brand?.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">{r.brand}</span>{" "}
                          <span className="text-ink/50">{r.item_id} · {r.size}</span>
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          {fmtShort(dateOnly(r.start_date))} – {fmtShort(dateOnly(r.due_date))}
                          {" · "}{money(r.rental_price)}
                          {Number(r.late_fee) > 0 && ` · ${money(r.late_fee)} late fee`}
                          {r.damaged && " · damaged"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {(r.status === "active" || r.status === "completed") &&
                          (detail.credited_rental_ids.includes(r.id) ? (
                            <span className="text-[11px] text-sage-deep">✓ post credit</span>
                          ) : (
                            <button
                              onClick={() => grantPostCredit(r.id)}
                              className="rounded-full border border-ink/15 px-2.5 py-1 text-[11px] text-ink/55"
                              title="Customer posted this rental — grant store credit"
                            >
                              + post credit
                            </button>
                          ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    const res = await fetch("/api/customers");
    if (res.ok) setCustomers(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  const list = (customers ?? []).filter((c) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      c.name.toLowerCase().includes(t) ||
      (c.phone ?? "").replace(/\D/g, "").includes(t.replace(/\D/g, "") || " ") ||
      (c.instagram ?? "").toLowerCase().includes(t)
    );
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="text-4xl font-medium md:text-5xl">Customers</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          {customers?.length ?? "…"} customers · new ones appear automatically
          when you book them
        </p>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, Instagram…"
          className="mt-6 w-full max-w-sm rounded-full border border-ink/15 bg-white px-4.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
        />

        <div className="mt-5 space-y-2">
          {customers === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))
          ) : list.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink/45">
              {customers.length === 0
                ? "No customers yet — they'll show up with their first booking."
                : "No one matches that search."}
            </p>
          ) : (
            list.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left transition-colors hover:bg-white/70"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lavender/50 font-serif text-lg italic">
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[16px]">
                    {c.name}
                    <FlagBadge flag={c.flag} />
                    {c.rental_count >= 2 && (
                      <span className="rounded-full bg-lavender px-2.5 py-0.5 text-[11px] font-medium">
                        repeat
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[13px] text-ink/55">
                    {[c.phone, c.instagram].filter(Boolean).join(" · ") ||
                      "no contact info"}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-ink/55">
                  {c.rental_count} rental{c.rental_count === 1 ? "" : "s"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {openId !== null && (
        <DetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </AppShell>
  );
}
