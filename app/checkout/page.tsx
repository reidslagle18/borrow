"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import CameraScanner from "@/components/CameraScanner";
import { beep } from "@/lib/scanSound";
import {
  Item,
  Customer,
  CLEANING_FEE_DEFAULT,
  RENTAL_DAYS,
  AGREEMENT_TERMS,
  tierLabel,
} from "@/lib/types";
import { todayISO, addDays, fmtShort } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

function money(n: number): string {
  return `$${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;
}

export default function CheckoutPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState("");

  // selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  // customer
  const [customerId, setCustomerId] = useState<number | "">("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerListOpen, setCustomerListOpen] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncEmail, setNcEmail] = useState("");

  // terms
  const [startDate, setStartDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(addDays(todayISO(), RENTAL_DAYS));
  const [dueTouched, setDueTouched] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [agreementName, setAgreementName] = useState("");

  const [ambCustomerIds, setAmbCustomerIds] = useState<Set<number>>(new Set());
  const [cleaningFee, setCleaningFee] = useState<number>(CLEANING_FEE_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{
    id: number;
    emailSent: boolean;
    ambassadorApplied: boolean;
    blackout: boolean;
    referredBy: string | null;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [ir, cr, ar, sr] = await Promise.all([
          fetch("/api/items"),
          fetch("/api/customers"),
          fetch("/api/ambassadors"),
          fetch("/api/settings"),
        ]);
        if (!ir.ok) throw new Error("items");
        setItems(await ir.json());
        if (cr.ok) setCustomers(await cr.json());
        if (sr.ok) {
          const s = await sr.json();
          if (s.program?.cleaning_fee != null) setCleaningFee(s.program.cleaning_fee);
        }
        if (ar.ok) {
          const amb = await ar.json();
          setAmbCustomerIds(
            new Set(
              amb
                .map((a: { customer_id: number | null }) => a.customer_id)
                .filter((v: number | null): v is number => v != null)
            )
          );
        }
      } catch {
        setLoadError("Couldn't load inventory — refresh to try again.");
      }
    })();
  }, []);

  const isAmbassador = customerId !== "" && ambCustomerIds.has(customerId);

  const byId = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  const selected = useMemo(
    () => selectedIds.map((id) => byId.get(id)).filter(Boolean) as Item[],
    [selectedIds, byId]
  );

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  const customerMatches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
          (c.email ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [customers, customerQuery]);

  const subtotal = selected.reduce((s, i) => s + Number(i.rental_price), 0);
  const waiverTotal = selected.length * cleaningFee;
  const total = subtotal + waiverTotal;

  function addPiece(item: Item): { ok: boolean; msg: string } {
    if (selectedIds.includes(item.id)) {
      return { ok: false, msg: `${item.brand} is already in this checkout.` };
    }
    if (item.status !== "available" && item.status !== "reserved") {
      return { ok: false, msg: `${item.brand} isn't available (${item.status}).` };
    }
    setSelectedIds((prev) => [...prev, item.id]);
    return { ok: true, msg: "" };
  }

  function handleScan(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const match = items.find((i) => i.barcode === code || i.id === code);
    if (!match) {
      beep(false);
      setScanMsg(`No piece with barcode ${code}.`);
      return;
    }
    const res = addPiece(match);
    if (res.ok) {
      beep(true);
      setScanMsg("");
    } else {
      beep(false);
      setScanMsg(res.msg);
    }
  }

  function pickStart(d: string) {
    setStartDate(d);
    if (!dueTouched && d) setDueDate(addDays(d, RENTAL_DAYS));
  }

  async function addCustomer() {
    if (!ncName.trim()) return;
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ncName.trim(),
        phone: ncPhone.trim(),
        email: ncEmail.trim(),
      }),
    });
    if (res.ok) {
      const c: Customer = await res.json();
      setCustomers((prev) => [...prev, c]);
      setCustomerId(c.id);
      if (c.email) setReceiptEmail(c.email);
      if (!agreementName) setAgreementName(c.name);
      setShowNewCustomer(false);
      setNcName("");
      setNcPhone("");
      setNcEmail("");
    }
  }

  function selectCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerListOpen(false);
    if (c.email) setReceiptEmail(c.email);
    if (!agreementName) setAgreementName(c.name);
  }

  async function checkout() {
    if (selected.length === 0) {
      setError("Add at least one piece.");
      return;
    }
    if (!accepted) {
      setError("The customer must accept the rental agreement.");
      return;
    }
    if (!agreementName.trim()) {
      setError("Enter the name of the person accepting the agreement.");
      return;
    }
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customerId === "" ? null : customerId,
        item_ids: selectedIds,
        start_date: startDate,
        due_date: dueDate,
        agreement_accepted: accepted,
        agreement_name: agreementName.trim(),
        receipt_email: receiptEmail.trim() || null,
        referral_code: referralCode.trim() || null,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setDone({
        id: data.transaction.id,
        emailSent: data.email_sent,
        ambassadorApplied: !!data.ambassador_applied,
        blackout: !!data.blackout,
        referredBy: data.referred_by ?? null,
      });
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Checkout failed — try again.");
      setSubmitting(false);
    }
  }

  function reset() {
    setSelectedIds([]);
    setCustomerId("");
    setCustomerQuery("");
    setReceiptEmail("");
    setReferralCode("");
    setAccepted(false);
    setAgreementName("");
    setStartDate(todayISO());
    setDueDate(addDays(todayISO(), RENTAL_DAYS));
    setDueTouched(false);
    setError("");
    setDone(null);
    setSubmitting(false);
  }

  if (done) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-5 py-16 text-center md:px-10">
          <p className="font-serif text-5xl italic text-sage-deep">✓</p>
          <h1 className="mt-3 font-serif text-4xl font-medium">Checked out</h1>
          <p className="mt-2 text-ink/60">
            Order #{done.id} · {selected.length} piece
            {selected.length === 1 ? "" : "s"} now marked Rented Out · total{" "}
            {money(total)}.
          </p>
          <p className="mt-1 text-sm text-ink/50">
            {done.emailSent
              ? "Receipt emailed to the customer."
              : "Receipt email not sent (email isn't configured yet)."}
          </p>
          {done.ambassadorApplied && (
            <p className="mt-1 text-sm text-sage-deep">
              Ambassador credits applied automatically.
            </p>
          )}
          {done.blackout && (
            <p className="mt-1 text-sm text-blush-deep">
              Blackout date — full price charged (ambassador perks suppressed).
            </p>
          )}
          {done.referredBy && (
            <p className="mt-1 text-sm text-ink/50">
              Referral credited to {done.referredBy}.
            </p>
          )}
          <div className="mt-8 flex justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream"
            >
              New checkout
            </button>
            <Link
              href="/inventory"
              className="rounded-full border border-ink/15 px-6 py-3 text-[15px] text-ink/60"
            >
              Back to inventory
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Checkout</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Scan or add pieces, link a customer, collect payment.
        </p>

        {loadError && (
          <p className="mt-6 rounded-2xl bg-blush/20 px-4 py-3 text-sm text-ink/70">
            {loadError}
          </p>
        )}

        {/* Add pieces */}
        <section className="mt-7">
          <label className={labelCls}>Pieces</label>
          <div className="flex gap-2">
            <input
              value={scanInput}
              onChange={(e) => {
                setScanInput(e.target.value);
                if (scanMsg) setScanMsg("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleScan(scanInput);
                  setScanInput("");
                }
              }}
              placeholder="Scan or type a barcode…"
              inputMode="numeric"
              autoFocus
              className={`${inputCls} font-mono`}
            />
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="shrink-0 rounded-xl border border-ink/15 bg-white px-4 text-[15px] text-ink/70"
            >
              Camera
            </button>
          </div>
          {scanMsg && (
            <p className="mt-1.5 text-[13px] text-blush-deep">{scanMsg}</p>
          )}

          {/* Manual fallback select */}
          <select
            value=""
            onChange={(e) => {
              const it = byId.get(e.target.value);
              if (it) {
                const r = addPiece(it);
                if (!r.ok) setScanMsg(r.msg);
              }
            }}
            className={`${inputCls} mt-2`}
          >
            <option value="">+ Add a piece from the list…</option>
            {items
              .filter(
                (i) =>
                  (i.status === "available" || i.status === "reserved") &&
                  !selectedIds.includes(i.id)
              )
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.brand} · {i.barcode || i.id} · {i.size} · {money(Number(i.rental_price))}
                </option>
              ))}
          </select>

          {/* Selected list */}
          <div className="mt-4 space-y-2">
            {selected.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink/40">
                No pieces yet — scan one to start.
              </p>
            ) : (
              selected.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white px-3.5 py-2.5"
                >
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                    {i.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.photo_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{i.brand}</p>
                    <p className="text-[13px] text-ink/50">
                      <span className="font-mono">{i.barcode || i.id}</span> ·{" "}
                      {tierLabel(i.tier)} · {money(Number(i.rental_price))} +{" "}
                      {money(cleaningFee)} cleaning
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setSelectedIds((prev) => prev.filter((x) => x !== i.id))
                    }
                    className="shrink-0 rounded-full px-2 text-lg leading-none text-ink/40 hover:bg-ink/5"
                    aria-label="Remove piece"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Customer */}
        <section className="mt-7">
          <label className={labelCls}>Customer</label>
          {selectedCustomer ? (
            <div className="flex items-center justify-between rounded-xl border border-ink/15 bg-white px-3.5 py-2.5">
              <span className="truncate text-[15px]">
                {selectedCustomer.name}
                {selectedCustomer.phone && (
                  <span className="text-ink/50"> · {selectedCustomer.phone}</span>
                )}
              </span>
              <button
                onClick={() => {
                  setCustomerId("");
                  setCustomerQuery("");
                }}
                className="ml-2 shrink-0 rounded-full px-2 text-lg leading-none text-ink/40 hover:bg-ink/5"
                aria-label="Clear customer"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                className={inputCls}
                placeholder="Search name, phone or email…"
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setCustomerListOpen(true);
                }}
                onFocus={() => setCustomerListOpen(true)}
                onBlur={() => setTimeout(() => setCustomerListOpen(false), 150)}
              />
              {customerListOpen && (
                <div className="absolute z-10 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-ink/10 bg-white shadow-lg">
                  {customerMatches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectCustomer(c)}
                      className="block w-full px-3.5 py-2.5 text-left text-[15px] hover:bg-cream"
                    >
                      {c.name}
                      {c.phone && <span className="text-ink/45"> · {c.phone}</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setNcName(customerQuery.trim());
                      setShowNewCustomer(true);
                      setCustomerListOpen(false);
                    }}
                    className="block w-full border-t border-ink/10 px-3.5 py-2.5 text-left text-[15px] text-ink/60 hover:bg-cream"
                  >
                    + New customer
                    {customerQuery.trim() ? ` “${customerQuery.trim()}”` : ""}
                  </button>
                </div>
              )}
            </div>
          )}
          {showNewCustomer && (
            <div className="mt-3 space-y-2">
              <input
                className={inputCls}
                placeholder="Name"
                value={ncName}
                onChange={(e) => setNcName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  placeholder="Phone (optional)"
                  value={ncPhone}
                  onChange={(e) => setNcPhone(e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="Email (for receipt)"
                  value={ncEmail}
                  onChange={(e) => setNcEmail(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={addCustomer}
                  className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(false)}
                  className="rounded-full px-4 py-1.5 text-sm text-ink/50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>

        {isAmbassador && (
          <div className="mt-3 rounded-2xl bg-sage/30 px-4 py-3 text-sm text-ink/70">
            ✦ This customer is an ambassador — their monthly perk credits apply
            automatically (free → bonus → $6 → full), unless the start date is a
            blackout day.
          </div>
        )}

        {/* Dates */}
        <section className="mt-7 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Start date</label>
            <input
              type="date"
              className={inputCls}
              value={startDate}
              onChange={(e) => pickStart(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Due date ({RENTAL_DAYS}-day)</label>
            <input
              type="date"
              className={inputCls}
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setDueTouched(true);
              }}
            />
          </div>
        </section>

        {/* Receipt email + referral code */}
        <section className="mt-7 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Receipt email</label>
            <input
              type="email"
              className={inputCls}
              placeholder="customer@email.com"
              value={receiptEmail}
              onChange={(e) => setReceiptEmail(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Referral code (optional)</label>
            <input
              className={`${inputCls} font-mono uppercase`}
              placeholder="Ambassador code"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            />
          </div>
        </section>

        {/* Totals */}
        <section className="mt-7 rounded-2xl bg-white/70 p-5">
          <div className="flex justify-between text-sm text-ink/60">
            <span>
              Pieces ({selected.length}) — {fmtShort(startDate)} →{" "}
              {fmtShort(dueDate)}
            </span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="mt-1.5 flex justify-between text-sm text-ink/60">
            <span>
              Cleaning &amp; Care Fee ({selected.length} × {money(cleaningFee)})
            </span>
            <span>{money(waiverTotal)}</span>
          </div>
          <div className="mt-3 flex justify-between border-t border-ink/10 pt-3 text-lg font-medium">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </section>

        {/* Agreement */}
        <section className="mt-7 rounded-2xl border border-ink/10 p-5">
          <h2 className="font-serif text-xl italic text-ink/70">
            Rental agreement
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink/60">
            {AGREEMENT_TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <label className="mt-4 flex items-start gap-2.5 text-[15px]">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-4 w-4 accent-ink"
            />
            <span>The customer has read and accepts the rental agreement.</span>
          </label>
          {accepted && (
            <input
              className={`${inputCls} mt-3`}
              placeholder="Name of person accepting"
              value={agreementName}
              onChange={(e) => setAgreementName(e.target.value)}
            />
          )}
        </section>

        {error && <p className="mt-4 text-sm text-blush-deep">{error}</p>}

        <button
          onClick={checkout}
          disabled={submitting || selected.length === 0}
          className="mt-6 w-full rounded-full bg-ink px-6 py-4 text-base text-cream transition-opacity disabled:opacity-40"
        >
          {submitting
            ? "Processing…"
            : `Collect payment & check out · ${money(total)}`}
        </button>
        <p className="mt-2 text-center text-xs text-ink/40">
          Payment is collected on the card reader; this records the transaction
          and marks pieces Rented Out.
        </p>
      </div>

      {scanOpen && (
        <CameraScanner
          onResult={(text) => {
            handleScan(text);
            setScanOpen(false);
          }}
          onClose={() => setScanOpen(false)}
        />
      )}
    </AppShell>
  );
}
