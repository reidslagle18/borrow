"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
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

// Stripe is optional — if the publishable key isn't set, checkout still works
// without saving a card.
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

function money(n: number): string {
  return `$${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;
}

type TerminalReader = {
  id: string;
  label: string | null;
  device_type: string;
  status: string;
  location: string | null;
  location_name: string | null;
};

const REMEMBERED_READER_KEY = "borrow_terminal_reader";

export default function CheckoutPage() {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutInner />
    </Elements>
  );
}

function CheckoutInner() {
  const stripe = useStripe();
  const elements = useElements();
  const stripeEnabled = !!stripePromise;
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
  // Terminal readers are looked up live from Stripe (never a stored id, which
  // could be from the wrong mode). null = still loading.
  const [readers, setReaders] = useState<TerminalReader[] | null>(null);
  const [readerId, setReaderId] = useState(""); // the chosen/active reader
  const [readerError, setReaderError] = useState("");
  const [readerCleared, setReaderCleared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // In-person tap state: shown as an overlay once an order is created and the
  // reader is collecting payment.
  const [tap, setTap] = useState<{
    status: "waiting" | "error";
    txId: number;
    piId: string | null;
    message?: string;
  } | null>(null);
  const [done, setDone] = useState<{
    id: number;
    emailSent: boolean;
    ambassadorApplied: boolean;
    blackout: boolean;
    referredBy: string | null;
    creditApplied: number;
    paymentPending: boolean;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [ir, cr, ar, sr, rd] = await Promise.all([
          fetch("/api/items"),
          fetch("/api/customers"),
          fetch("/api/ambassadors"),
          fetch("/api/settings"),
          fetch("/api/stripe/terminal/readers"),
        ]);
        if (!ir.ok) throw new Error("items");
        setItems(await ir.json());
        if (cr.ok) setCustomers(await cr.json());
        let settingsPref = "";
        if (sr.ok) {
          const s = await sr.json();
          if (s.program?.cleaning_fee != null) setCleaningFee(s.program.cleaning_fee);
          if (s.program?.terminal_reader_id) settingsPref = s.program.terminal_reader_id;
        }
        // Resolve the reader from the LIVE list: prefer the one remembered on
        // this device, else the settings default, but only if it actually
        // exists now; if just one reader, use it; if several, make staff pick.
        if (rd.ok) {
          const list: TerminalReader[] = (await rd.json()).readers || [];
          setReaders(list);
          if (list.length === 0) {
            setReaderError("No reader connected in Stripe — check Terminal → Readers.");
          } else {
            const remembered =
              (typeof localStorage !== "undefined" &&
                localStorage.getItem(REMEMBERED_READER_KEY)) ||
              "";
            const pref = [remembered, settingsPref].find(
              (id) => id && list.some((x) => x.id === id)
            );
            if (pref) setReaderId(pref);
            else if (list.length === 1) setReaderId(list[0].id);
          }
        } else {
          // Stripe not configured / lookup failed → no in-person tap available.
          setReaders([]);
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
  // In-person tap is the payment method whenever this account has at least one
  // live Terminal reader; then we skip the manual card-on-file step.
  const useTerminal = (readers?.length ?? 0) > 0;
  const needsReaderChoice = useTerminal && !readerId;

  function pickReader(id: string) {
    setReaderId(id);
    try {
      localStorage.setItem(REMEMBERED_READER_KEY, id);
    } catch {
      /* private mode — fine, it just won't be remembered */
    }
  }

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
    const qDigits = q.replace(/\D/g, "");
    // Rank by closeness so the best match is first (lower score = closer):
    // exact name < name prefix < any-word prefix < substring, with phone/email
    // matches scored similarly. Ties break alphabetically.
    const scored: { c: Customer; score: number }[] = [];
    for (const c of customers) {
      const name = c.name.toLowerCase();
      const email = (c.email ?? "").toLowerCase();
      const phone = (c.phone ?? "").replace(/\D/g, "");
      let score = Infinity;
      if (name === q) score = 0;
      else if (name.startsWith(q)) score = 1;
      else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
      else if (name.includes(q)) score = 3;
      if (qDigits && phone.includes(qDigits)) {
        score = Math.min(score, phone.startsWith(qDigits) ? 2 : 4);
      }
      if (email.startsWith(q)) score = Math.min(score, 2);
      else if (q && email.includes(q)) score = Math.min(score, 5);
      if (score !== Infinity) scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
    return scored.slice(0, 8).map((s) => s.c);
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

  // Holds the created order between "check out" and a successful tap, so the
  // done screen can report ambassador/credit/referral details after payment.
  const pendingOrder = useRef<{
    transaction: { id: number };
    email_sent: boolean;
    ambassador_applied: boolean;
    blackout: boolean;
    referred_by: string | null;
    credit_applied: number;
  } | null>(null);

  // Tell the reader to stop prompting (clears a stuck "please tap" screen).
  async function clearReader() {
    const rid = chargedReaderRef.current || readerId;
    if (!rid) return;
    await fetch("/api/stripe/terminal/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reader_id: rid }),
    }).catch(() => {});
  }

  // Throw away a not-yet-paid order (e.g. the tap was canceled) so the piece is
  // freed instead of left marked Rented Out. Also stops the reader prompting.
  async function discardOrder() {
    const data = pendingOrder.current;
    setTap(null);
    await clearReader();
    if (data?.transaction?.id) {
      await fetch("/api/checkout/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: data.transaction.id }),
      }).catch(() => {});
    }
    pendingOrder.current = null;
    setSubmitting(false);
  }

  function finishTerminal(paymentPending: boolean) {
    const data = pendingOrder.current;
    if (!data) return;
    // Finishing without a completed tap → stop the reader still prompting.
    if (paymentPending) clearReader();
    setTap(null);
    setDone({
      id: data.transaction.id,
      emailSent: data.email_sent,
      ambassadorApplied: !!data.ambassador_applied,
      blackout: !!data.blackout,
      referredBy: data.referred_by ?? null,
      creditApplied: Number(data.credit_applied) || 0,
      paymentPending,
    });
  }

  // The reader the charge actually went to (from the live resolution), so a
  // cancel targets the right device.
  const chargedReaderRef = useRef<string>("");

  async function startTap(txId: number) {
    setTap({ status: "waiting", txId, piId: null });
    try {
      const cr = await fetch("/api/stripe/terminal/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: txId, reader_id: readerId || undefined }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok) {
        // Live resolution says the reader picture changed — surface it clearly
        // and let staff re-pick without losing the order.
        if (cd.code === "multiple_readers" && Array.isArray(cd.readers)) {
          setReaders(cd.readers);
          setReaderId("");
        } else if (cd.code === "no_reader") {
          setReaderError(cd.error);
        }
        setTap({ status: "error", txId, piId: null, message: cd.error || "Couldn't start the reader." });
        return;
      }
      chargedReaderRef.current = cd.reader_id || readerId;
      if (cd.status === "succeeded") return finishTerminal(false); // nothing to charge
      setTap({ status: "waiting", txId, piId: cd.payment_intent_id });
      pollTap(cd.payment_intent_id, txId, 0, chargedReaderRef.current);
    } catch {
      setTap({ status: "error", txId, piId: null, message: "Couldn't reach the reader." });
    }
  }

  async function pollTap(piId: string, txId: number, attempt: number, reader: string) {
    const MAX = 45; // ~90s at 2s intervals
    try {
      const pr = await fetch("/api/stripe/terminal/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_intent_id: piId,
          transaction_id: txId,
          reader_id: reader || undefined,
        }),
      });
      const pd = await pr.json().catch(() => ({}));
      if (pd.status === "succeeded") return finishTerminal(false);
      if (pd.status === "canceled")
        return setTap({ status: "error", txId, piId, message: "Payment canceled on the reader." });
      if (pd.status === "declined")
        return setTap({ status: "error", txId, piId, message: "Card was declined — try again or use another card." });
      if (pd.status === "failed")
        return setTap({ status: "error", txId, piId, message: "Payment wasn't collected." });
      if (attempt >= MAX)
        return setTap({ status: "error", txId, piId, message: "Timed out waiting for the tap." });
      setTimeout(() => pollTap(piId, txId, attempt + 1, reader), 2000);
    } catch {
      if (attempt >= MAX)
        return setTap({ status: "error", txId, piId, message: "Lost connection to the reader." });
      setTimeout(() => pollTap(piId, txId, attempt + 1, reader), 2000);
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
    setTap({
      status: "error",
      txId: t.txId,
      piId: t.piId,
      message: "Canceled. Tap again, or finish and collect another way.",
    });
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
    // When card-on-file is in use (Stripe on, no tap reader), a customer + saved
    // card are required (the agreement authorizes off-session late-fee /
    // replacement charges to this card).
    if (stripeEnabled && !useTerminal && customerId === "") {
      setError("Add a customer so their card can be saved on file.");
      return;
    }
    // Several readers registered but none chosen yet.
    if (needsReaderChoice) {
      setError("Choose which reader to charge before checking out.");
      return;
    }
    setSubmitting(true);
    setError("");

    // In-person tap: create the order (pending), then collect on the reader.
    if (useTerminal) {
      try {
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
            payment_mode: "terminal",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Checkout failed — try again.");
          setSubmitting(false);
          return;
        }
        pendingOrder.current = data;
        await startTap(data.transaction.id);
      } catch {
        setError("Checkout failed — try again.");
        setSubmitting(false);
      }
      return;
    }

    // Save the card via SetupIntent before booking.
    let stripeCustomerId: string | null = null;
    let stripePaymentMethodId: string | null = null;
    if (stripeEnabled && customerId !== "") {
      try {
        const siRes = await fetch("/api/stripe/setup-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customer_id: customerId }),
        });
        const si = await siRes.json();
        if (!siRes.ok) throw new Error(si.error || "Couldn't start card setup");
        const card = elements?.getElement(CardElement);
        if (!stripe || !card) throw new Error("Card field not ready — try again.");
        const result = await stripe.confirmCardSetup(si.clientSecret, {
          payment_method: { card },
        });
        if (result.error) {
          setError(result.error.message || "Card couldn't be saved.");
          setSubmitting(false);
          return;
        }
        stripeCustomerId = si.stripeCustomerId;
        stripePaymentMethodId =
          typeof result.setupIntent?.payment_method === "string"
            ? result.setupIntent.payment_method
            : null;
      } catch (err) {
        setError((err as Error).message || "Card setup failed — try again.");
        setSubmitting(false);
        return;
      }
    }

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
        stripe_customer_id: stripeCustomerId,
        stripe_payment_method_id: stripePaymentMethodId,
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
        creditApplied: Number(data.credit_applied) || 0,
        paymentPending: false,
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
    setTap(null);
    pendingOrder.current = null;
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
          {done.paymentPending && (
            <p className="mt-2 rounded-xl bg-butter/40 px-4 py-2 text-sm text-ink/70">
              Payment not collected on the reader — order #{done.id} is marked
              pending. Collect payment another way, then mark it paid.
            </p>
          )}
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
          {done.creditApplied > 0 && (
            <p className="mt-1 text-sm text-sage-deep">
              {money(done.creditApplied)} store credit applied.
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
                  {i.name || i.brand} · {i.barcode || i.id} · {i.size} · {money(Number(i.rental_price))}
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
                    <p className="truncate text-[15px] font-medium">{i.name || i.brand}</p>
                    <p className="text-[13px] text-ink/50">
                      <span className="font-mono">{i.barcode || i.id}</span> ·{" "}
                      {tierLabel(i.tier)} · {money(Number(i.rental_price))} +{" "}
                      {money(cleaningFee)} cleaning
                    </p>
                    {i.replacement_value != null && Number(i.replacement_value) > 0 && (
                      <p className="text-[12px] text-ink/40">
                        Replacement value {money(Number(i.replacement_value))} if
                        lost or damaged beyond repair
                      </p>
                    )}
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
                  {/* Pinned at the top so you can add someone in one tap. */}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setNcName(customerQuery.trim());
                      setShowNewCustomer(true);
                      setCustomerListOpen(false);
                    }}
                    className="sticky top-0 z-10 block w-full border-b border-ink/10 bg-white px-3.5 py-2.5 text-left text-[15px] font-medium text-ink/70 hover:bg-cream"
                  >
                    + Add customer
                    {customerQuery.trim() ? ` “${customerQuery.trim()}”` : ""}
                  </button>
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

        {/* Card on file (Stripe) — only when there's no tap reader */}
        {stripeEnabled && !useTerminal && (
          <section className="mt-7">
            <label className={labelCls}>Card on file</label>
            <div className="rounded-xl border border-ink/15 bg-white px-3.5 py-3">
              <CardElement options={{ hidePostalCode: false }} />
            </div>
            <p className="mt-1.5 text-[12px] text-ink/45">
              Saved securely with Stripe. By accepting the agreement, the customer
              authorizes BORROW to charge this card for late fees or a
              non-returned piece.
            </p>
          </section>
        )}

        {/* Card reader (in-person tap) */}
        {useTerminal && (
          <section className="mt-7">
            <label className={labelCls}>Card reader</label>
            {needsReaderChoice ? (
              <>
                <p className="mb-2 text-[13px] text-ink/60">
                  More than one reader is registered — pick which one to charge:
                </p>
                <div className="space-y-1.5">
                  {(readers ?? []).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pickReader(r.id)}
                      className="block w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2 text-left text-sm hover:bg-cream"
                    >
                      <span className="font-medium">{r.label || r.device_type}</span>
                      <span className="text-ink/50">
                        {" "}
                        · {r.location_name || "No location"} · {r.status}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm">
                <span>
                  Charging to{" "}
                  <span className="font-medium">
                    {(readers ?? []).find((r) => r.id === readerId)?.label || "reader"}
                  </span>
                  {(() => {
                    const r = (readers ?? []).find((x) => x.id === readerId);
                    return r?.location_name ? (
                      <span className="text-ink/50"> · {r.location_name}</span>
                    ) : null;
                  })()}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      await clearReader();
                      setReaderCleared(true);
                      setTimeout(() => setReaderCleared(false), 2500);
                    }}
                    className="text-ink/50 underline underline-offset-2"
                    title="Stop the reader if it's stuck showing 'please tap'"
                  >
                    {readerCleared ? "Cleared ✓" : "Clear reader"}
                  </button>
                  {(readers?.length ?? 0) > 1 && (
                    <button
                      type="button"
                      onClick={() => setReaderId("")}
                      className="text-ink/50 underline underline-offset-2"
                    >
                      Change
                    </button>
                  )}
                </span>
              </div>
            )}
            <p className="mt-1.5 text-[12px] text-ink/45">
              The customer pays on the reader. Their card is saved for later
              late-fee / damage charges.
            </p>
          </section>
        )}
        {readers !== null && readers.length === 0 && readerError && (
          <section className="mt-7">
            <div className="rounded-2xl bg-butter/40 px-4 py-3 text-sm text-ink/70">
              {readerError} In-person tap is unavailable until a reader is
              connected; you can still save a card on file and collect payment
              another way.
            </div>
          </section>
        )}

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
          disabled={submitting || selected.length === 0 || needsReaderChoice}
          className="mt-6 w-full rounded-full bg-ink px-6 py-4 text-base text-cream transition-opacity disabled:opacity-40"
        >
          {submitting
            ? "Processing…"
            : needsReaderChoice
              ? "Pick a reader above to continue"
              : useTerminal
                ? `Charge on reader & check out · ${money(total)}`
                : `Collect payment & check out · ${money(total)}`}
        </button>
        <p className="mt-2 text-center text-xs text-ink/40">
          {useTerminal
            ? "Creates the order, then prompts the customer to tap their card on the reader."
            : "Payment is collected on the card reader; this records the transaction and marks pieces Rented Out."}
        </p>
      </div>

      {/* In-person tap overlay */}
      {tap && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-5">
          <div className="w-full max-w-sm rounded-3xl bg-cream p-7 text-center shadow-xl">
            {tap.status === "waiting" ? (
              <>
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-ink/15 border-t-ink" />
                <h2 className="font-serif text-2xl font-medium">Tap to pay</h2>
                <p className="mt-2 text-[15px] text-ink/60">
                  Ask the customer to tap, insert, or swipe their card on the
                  reader to pay {money(total)}.
                </p>
                <button
                  onClick={cancelTap}
                  className="mt-6 rounded-full border border-ink/15 px-6 py-2.5 text-[15px] text-ink/60"
                >
                  Cancel tap
                </button>
              </>
            ) : (
              <>
                <p className="font-serif text-4xl italic text-blush-deep">!</p>
                <h2 className="mt-2 font-serif text-2xl font-medium">
                  Payment not collected
                </h2>
                <p className="mt-2 text-[15px] text-ink/60">{tap.message}</p>
                <div className="mt-6 flex flex-col gap-2">
                  <button
                    onClick={() => startTap(tap.txId)}
                    className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream"
                  >
                    Tap again
                  </button>
                  <button
                    onClick={() => finishTerminal(true)}
                    className="rounded-full px-6 py-2 text-[15px] text-ink/50"
                  >
                    Finish &amp; collect another way
                  </button>
                  <button
                    onClick={discardOrder}
                    className="rounded-full px-6 py-2 text-[15px] text-blush-deep"
                  >
                    Cancel &amp; free the piece
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
