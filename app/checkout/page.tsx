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
  salesTax,
  RENTAL_DAYS,
  AGREEMENT_TERMS,
  extraRentalDays,
  EXTRA_DAY_RATE,
  nextOpenDate,
  isClosedDay,
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

/**
 * The part of an item's condition notes worth flagging to a renter at checkout —
 * real flaws the owner recorded (stains, tears, marks) — with pure system
 * lifecycle log lines stripped out so routine history doesn't trigger a prompt.
 * Returns null when there's nothing disclosable.
 */
function disclosableCondition(item: Item): string | null {
  const notes = (item.condition_notes || "").trim();
  if (!notes) return null;
  const SYSTEM =
    /pickup notice sent|out to consignor|returned to consignor|back on rack|initial clean|moved to storage|in storage|total loss|storage window|dry clean at retrieval/i;
  const kept = notes
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !SYSTEM.test(l));
  const text = kept.join("\n").trim();
  return text || null;
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
  // Condition disclosure: a piece with noted flaws waits for the owner to show
  // the customer and confirm before it's added. `acked` remembers confirmations.
  const [disclosePiece, setDisclosePiece] = useState<Item | null>(null);
  const [ackedDisclosures, setAckedDisclosures] = useState<Set<string>>(new Set());

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
  // Same-day safeguard: a pickup left at today is almost always a reservation
  // whose future date wasn't set — require an explicit "yes, today" first.
  const [sameDayConfirmed, setSameDayConfirmed] = useState(false);
  const [showSameDayConfirm, setShowSameDayConfirm] = useState(false);
  const startDateRef = useRef<HTMLInputElement>(null);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [chargeAuth, setChargeAuth] = useState(false);
  const [agreementName, setAgreementName] = useState("");
  const [campaignCode, setCampaignCode] = useState(""); // optional give-back tag

  const [hangerFee, setHangerFee] = useState(0);
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [closedWeekdays, setClosedWeekdays] = useState<number[]>([]);
  const [taxRate, setTaxRate] = useState(0);
  // How many days before a reservation's pickup a piece stops taking new rentals.
  const [protectDays, setProtectDays] = useState(14);
  // Cleaning/turnaround buffer — a rental must be back and cleaned this many days
  // before an upcoming reservation's pickup.
  const [turnaroundDays, setTurnaroundDays] = useState(4);
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
    creditApplied: number;
    creditRemaining: number;
    paymentPending: boolean;
    reserving: boolean;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [ir, cr, sr, rd] = await Promise.all([
          fetch("/api/items"),
          fetch("/api/customers"),
          fetch("/api/settings"),
          fetch("/api/stripe/terminal/readers"),
        ]);
        if (!ir.ok) throw new Error("items");
        setItems(await ir.json());
        if (cr.ok) setCustomers(await cr.json());
        let settingsPref = "";
        if (sr.ok) {
          const s = await sr.json();
          if (s.program?.hanger_fee != null) setHangerFee(Number(s.program.hanger_fee));
          if (Array.isArray(s.program?.store_closed_dates)) setClosedDates(s.program.store_closed_dates.map(String));
          if (Array.isArray(s.program?.store_closed_weekdays)) setClosedWeekdays(s.program.store_closed_weekdays.map(Number));
          if (s.program?.reservation_protect_days != null) setProtectDays(Number(s.program.reservation_protect_days));
          if (s.program?.turnaround_days != null) setTurnaroundDays(Number(s.program.turnaround_days));
          if (s.program?.sales_tax_rate != null) setTaxRate(Number(s.program.sales_tax_rate));
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
      } catch {
        setLoadError("Couldn't load inventory — refresh to try again.");
      }
    })();
  }, []);

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

  // Reservation safety net: while a just-created reservation is still on the
  // success screen, warn if staff try to close/refresh the tab. It's a nudge
  // that this order isn't fully done — its pickup still has to be confirmed on
  // pickup day, or the piece gets stuck (reserved, un-checkinable).
  useEffect(() => {
    if (!done?.reserving) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [done?.reserving]);

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
  // The Cleaning & Care Fee is already included in each rental price — nothing
  // extra is added at checkout.
  const taxTotal = salesTax(subtotal, taxRate);
  // Extended rental: days booked beyond the standard week cost $EXTRA_DAY_RATE
  // per item per day (kept by Borrow, like a late fee).
  const extraDays = extraRentalDays(startDate, dueDate);
  const extraFeeTotal = extraDays * EXTRA_DAY_RATE * selected.length;
  const total = subtotal + extraFeeTotal + taxTotal;
  // Store credit the selected customer has — previewed here, applied server-side.
  const creditAvailable = Number(selectedCustomer?.store_credit ?? 0);
  const creditWillApply = Math.min(creditAvailable, total);
  const totalAfterCredit = Math.round((total - creditWillApply) * 100) / 100;
  const creditLeftAfter = Math.round((creditAvailable - creditWillApply) * 100) / 100;
  // A closed PICKUP day blocks checkout (nobody's there to hand it over). A
  // closed RETURN day is fine — it rolls to the next open day (bring it back
  // then) at no penalty; the server stores that rolled due date.
  const closedPickup = isClosedDay(startDate, closedDates, closedWeekdays) ? startDate : null;
  const effectiveDue = nextOpenDate(dueDate, closedDates, closedWeekdays);
  const returnRolled = effectiveDue !== dueDate;
  // A future pickup date makes this a reservation (paid in full, piece held).
  const reserving = startDate > todayISO();

  // Last Safe Rental Date for a piece with an upcoming reservation (else null).
  // A piece with an upcoming reservation can still be rented out — as long as
  // THIS rental is returned AND cleaned (turnaround) before that reservation's
  // pickup. Blocks only when the actual dates would run into the reservation,
  // not a blanket days-out cutoff. (The server re-checks the full calendar.)
  function reservationBlocks(item: Item): boolean {
    if (!item.next_reservation_date) return false;
    return addDays(dueDate, turnaroundDays) >= item.next_reservation_date;
  }

  function addPiece(item: Item): { ok: boolean; msg: string } {
    if (selectedIds.includes(item.id)) {
      return { ok: false, msg: `${item.brand} is already in this checkout.` };
    }
    if (item.status === "rented") {
      return { ok: false, msg: `${item.brand} is Rented Out — can't check it out.` };
    }
    if (item.status === "consignor_hold") {
      return { ok: false, msg: `${item.brand} is on hold for its consignor — can't check it out.` };
    }
    if (item.status !== "available" && item.status !== "reserved") {
      return { ok: false, msg: `${item.brand} isn't available (${item.status}).` };
    }
    // Reserved piece: allow unless this rental's return + cleaning would run into
    // the upcoming reservation.
    if (reservationBlocks(item)) {
      return {
        ok: false,
        msg: `${item.brand} is reserved for ${fmtShort(item.next_reservation_date!)} — this rental's return (${fmtShort(dueDate)}) doesn't leave ${turnaroundDays} day${turnaroundDays === 1 ? "" : "s"} to clean it before then. Set the return date earlier to rent it out.`,
      };
    }
    // Has a noted flaw (stains, tears, etc.)? Pause and make the owner show the
    // customer + confirm before adding. Skipped once acknowledged this session.
    if (disclosableCondition(item) && !ackedDisclosures.has(item.id)) {
      setDisclosePiece(item);
      return { ok: true, msg: "" };
    }
    setSelectedIds((prev) => [...prev, item.id]);
    return { ok: true, msg: "" };
  }

  // Live conflict check: a piece already added can become unavailable when the
  // start date is moved onto/over an existing booking. Recomputed on every date
  // change so staff see it immediately, not at the very end of checkout.
  const conflictPieces = useMemo(
    () =>
      selected.filter((item) => {
        if (item.status === "rented") return true;
        return reservationBlocks(item);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, dueDate, turnaroundDays]
  );
  const conflictIds = new Set(conflictPieces.map((i) => i.id));

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
    // Any date change re-arms the same-day safeguard.
    setSameDayConfirmed(false);
    setShowSameDayConfirm(false);
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
  // done screen can report credit details after payment.
  const pendingOrder = useRef<{
    transaction: { id: number };
    email_sent: boolean;
    credit_applied: number;
    credit_remaining?: number;
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
      creditApplied: Number(data.credit_applied) || 0,
      creditRemaining: Number(data.credit_remaining) || 0,
      paymentPending,
      reserving,
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

  async function checkout(sameDayOk = false) {
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
    if (!chargeAuth) {
      setError("Confirm the automatic-charge authorization before checking out.");
      return;
    }
    if (closedPickup) {
      setError(`The studio is closed ${fmtShort(closedPickup)}, so the pickup can't be that day. Pick a different start date.`);
      return;
    }
    if (conflictPieces.length > 0) {
      setError(
        `${conflictPieces.map((p) => p.brand).join(", ")} ${conflictPieces.length === 1 ? "is" : "are"} already booked over ${fmtShort(startDate)} — pick a different piece or dates.`
      );
      return;
    }
    // Any card checkout (tap OR manual) must be tied to a customer so the card
    // is saved on file — the agreement authorizes off-session late-fee / damage /
    // replacement charges to it. Cash / Stripe-off checkouts are exempt.
    if (stripeEnabled && customerId === "") {
      setError("Add a customer so their card is saved on file for damage or late fees.");
      return;
    }
    // Several readers registered but none chosen yet.
    if (needsReaderChoice) {
      setError("Choose which reader to charge before checking out.");
      return;
    }
    // Same-day safeguard: if the pickup date is today (not a future
    // reservation) and hasn't been explicitly confirmed, stop and ask — this is
    // what prevents a future reservation from being saved as today by mistake.
    if (!reserving && !sameDayConfirmed && !sameDayOk) {
      setError("");
      setShowSameDayConfirm(true);
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
            charge_auth_accepted: chargeAuth,
            receipt_email: receiptEmail.trim() || null,
            campaign_code: campaignCode.trim() || null,
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
          charge_auth_accepted: chargeAuth,
          receipt_email: receiptEmail.trim() || null,
          campaign_code: campaignCode.trim() || null,
          stripe_customer_id: stripeCustomerId,
          stripe_payment_method_id: stripePaymentMethodId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDone({
          id: data.transaction.id,
          emailSent: data.email_sent,
          creditApplied: Number(data.credit_applied) || 0,
          creditRemaining: Number(data.credit_remaining) || 0,
          paymentPending: false,
          reserving,
        });
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Checkout failed — try again.");
        setSubmitting(false);
      }
    } catch {
      setError("Checkout failed — try again.");
      setSubmitting(false);
    }
  }

  function reset() {
    setSelectedIds([]);
    setCustomerId("");
    setCustomerQuery("");
    setReceiptEmail("");
    setAccepted(false);
    setChargeAuth(false);
    setAgreementName("");
    setStartDate(todayISO());
    setDueDate(addDays(todayISO(), RENTAL_DAYS));
    setDueTouched(false);
    setSameDayConfirmed(false);
    setShowSameDayConfirm(false);
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
          <h1 className="mt-3 font-serif text-4xl font-medium">
            {done.reserving ? "Reserved" : "Checked out"}
          </h1>
          <p className="mt-2 text-ink/60">
            Order #{done.id} · {selected.length} piece
            {selected.length === 1 ? "" : "s"}{" "}
            {done.reserving
              ? `held as a reservation for ${fmtShort(startDate)}`
              : "now marked Rented Out"}{" "}
            · total {money(total)}.
          </p>
          {done.reserving && (
            <div className="mt-4 rounded-2xl border-2 border-butter-deep/60 bg-butter/40 px-4 py-3.5 text-left">
              <p className="text-[15px] font-bold text-ink">
                Not fully done yet — this reservation still needs pickup
                confirmed.
              </p>
              <p className="mt-1 text-sm text-ink/75">
                Paid in full and held (shown as Reserved) for{" "}
                {fmtShort(startDate)}. When {selectedCustomer?.name || "the customer"}{" "}
                comes in, open the calendar and tap <strong>Picked up</strong> —
                otherwise the piece stays stuck as Reserved and can&apos;t be
                checked back in.
              </p>
              <Link
                href="/calendar"
                className="mt-3 inline-block rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream"
              >
                Go to calendar to confirm pickup →
              </Link>
              <p className="mt-3 text-[13px] text-ink/60">
                Canceling 48+ hours before {fmtShort(startDate)} refunds the
                rental price; within 48 hours it&apos;s non-refundable.
              </p>
            </div>
          )}
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
          {done.creditApplied > 0 && (
            <p className="mt-1 text-sm text-sage-deep">
              {money(done.creditApplied)} store credit applied
              {done.creditRemaining > 0
                ? ` · ${money(done.creditRemaining)} left on their balance`
                : " · balance now $0"}
              .
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
                  className={`flex items-center gap-3 rounded-2xl border bg-white px-3.5 py-2.5 ${
                    conflictIds.has(i.id) ? "border-blush-deep bg-blush/10" : "border-ink/10"
                  }`}
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
                      {money(Number(i.rental_price))} · Cleaning &amp; Care Fee included
                    </p>
                    {conflictIds.has(i.id) && (
                      <p className="text-[12px] font-medium text-blush-deep">
                        ⚠ Rented out over {fmtShort(startDate)} — not available for these dates.
                      </p>
                    )}
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

        {/* Dates */}
        <section className="mt-7 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Start date</label>
            <input
              ref={startDateRef}
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
          {extraDays > 0 && (
            <p className="col-span-2 text-[12px] text-ink/55">
              Extended rental: {extraDays} day{extraDays === 1 ? "" : "s"} past
              the standard week, charged {money(EXTRA_DAY_RATE)}/day per piece
              (added to the total below).
            </p>
          )}
          {closedPickup && (
            <p className="col-span-2 rounded-xl border-2 border-blush-deep/50 bg-blush/20 px-3.5 py-2.5 text-[13px] font-medium text-ink">
              The studio is closed {fmtShort(closedPickup)}, so the pickup can&apos;t
              be that day. Pick a different start date to continue.
            </p>
          )}
          {conflictPieces.length > 0 && (
            <p className="col-span-2 rounded-xl border-2 border-blush-deep/50 bg-blush/20 px-3.5 py-2.5 text-[13px] font-medium text-ink">
              ⚠ {conflictPieces.map((p) => p.brand).join(", ")}{" "}
              {conflictPieces.length === 1 ? "is" : "are"} already rented out over{" "}
              {fmtShort(startDate)}. Remove {conflictPieces.length === 1 ? "it" : "them"} or
              pick different dates to continue.
            </p>
          )}
          {returnRolled && !closedPickup && (
            <p className="col-span-2 rounded-xl border border-sage-deep/40 bg-sage/25 px-3.5 py-2.5 text-[13px] text-ink">
              We&apos;re closed {fmtShort(dueDate)}, so this rents through the next
              open day. They bring it back {fmtShort(effectiveDue)} — no late fee,
              no extra charge.
            </p>
          )}
        </section>

        {/* Receipt email */}
        <section className="mt-7">
          <label className={labelCls}>Receipt email</label>
          <input
            type="email"
            className={inputCls}
            placeholder="customer@email.com"
            value={receiptEmail}
            onChange={(e) => setReceiptEmail(e.target.value)}
          />
        </section>

        {/* Optional give-back campaign code (tags the order; no discount) */}
        <section className="mt-7">
          <label className={labelCls}>Campaign code (optional)</label>
          <input
            type="text"
            className={`${inputCls} uppercase`}
            placeholder="e.g. FIGHT"
            value={campaignCode}
            onChange={(e) => setCampaignCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
          />
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
          {extraFeeTotal > 0 && (
            <div className="mt-1.5 flex justify-between text-sm text-ink/60">
              <span>
                Extended rental ({extraDays} extra day{extraDays === 1 ? "" : "s"}
                {selected.length > 1 ? ` × ${selected.length} pieces` : ""} ×{" "}
                {money(EXTRA_DAY_RATE)}/day)
              </span>
              <span>{money(extraFeeTotal)}</span>
            </div>
          )}
          {taxTotal > 0 && (
            <div className="mt-1.5 flex justify-between text-sm text-ink/60">
              <span>Sales tax ({taxRate}%)</span>
              <span>{money(taxTotal)}</span>
            </div>
          )}
          <div className="mt-3 flex justify-between border-t border-ink/10 pt-3 text-lg font-medium">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
          {creditWillApply > 0 && (
            <>
              <div className="mt-2 flex justify-between text-sm text-sage-deep">
                <span>Store credit applied</span>
                <span>−{money(creditWillApply)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-ink/10 pt-2 text-lg font-medium">
                <span>Charge now</span>
                <span>{money(totalAfterCredit)}</span>
              </div>
              <p className="mt-1 text-[12px] text-ink/55">
                {creditLeftAfter > 0
                  ? `${money(creditLeftAfter)} store credit will remain on their balance after this order.`
                  : "This uses the last of their store credit."}
              </p>
            </>
          )}
          <p className="mt-2.5 rounded-xl bg-sage/25 px-3 py-2 text-[12px] text-ink/70">
            <span className="font-semibold">Cleaning &amp; Care Fee already
            included</span> in every price. Remind the customer: please don&apos;t
            clean the piece themselves — we handle all cleaning.
          </p>
          {hangerFee > 0 && (
            <p className="mt-2.5 text-[12px] text-ink/45">
              If the hanger isn&apos;t returned with the piece, the card on file
              is charged {money(hangerFee)} per hanger. Late returns are{" "}
              {money(15)}/item/day.
            </p>
          )}
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

        {/* Standalone automatic-charge authorization — deliberately separate
            from the rental-agreement box and placed right at the pay step so
            it can't be missed. Its own required checkbox. */}
        <section className="mt-7 rounded-2xl border-2 border-blush-deep/50 bg-blush/20 p-5">
          <p className="text-[15px] font-bold leading-relaxed text-ink">
            Your card on file will be automatically charged if this item is
            returned damaged beyond repair, not returned, or returned late
            ($15/day). You must bring the hanger back with the piece
            {hangerFee > 0 && <> or you will be charged {money(hangerFee)}</>}. By
            checking below, you agree to these charges.
          </p>
          <label className="mt-4 flex items-start gap-2.5 text-[15px] font-medium">
            <input
              type="checkbox"
              checked={chargeAuth}
              onChange={(e) => setChargeAuth(e.target.checked)}
              className="mt-1 h-5 w-5 accent-blush-deep"
            />
            <span>I authorize these automatic charges to the card on file.</span>
          </label>
        </section>

        {error && <p className="mt-4 text-sm text-blush-deep">{error}</p>}

        {/* Same-day safeguard — catches a future reservation accidentally left
            at today's date before it's saved. */}
        {showSameDayConfirm && (
          <section className="mt-6 rounded-2xl border-2 border-butter-deep/60 bg-butter/40 p-5">
            <p className="text-[15px] font-bold text-ink">
              Pickup is today ({fmtShort(startDate)}) — this rents the piece out
              now.
            </p>
            <p className="mt-1 text-[14px] text-ink/70">
              If this is a reservation for a <strong>future</strong> pickup date,
              set the pickup date first. Only continue if the customer is taking
              it home today.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => {
                  setShowSameDayConfirm(false);
                  startDateRef.current?.focus();
                  startDateRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="flex-1 rounded-full border border-ink/25 px-5 py-3 text-[15px] text-ink/70"
              >
                It&apos;s a future reservation — set the date
              </button>
              <button
                onClick={() => {
                  setSameDayConfirmed(true);
                  setShowSameDayConfirm(false);
                  checkout(true);
                }}
                className="flex-1 rounded-full bg-ink px-5 py-3 text-[15px] text-cream"
              >
                Yes, pick up today · {money(totalAfterCredit)}
              </button>
            </div>
          </section>
        )}

        <button
          onClick={() => checkout()}
          disabled={submitting || selected.length === 0 || needsReaderChoice || !!closedPickup || conflictPieces.length > 0}
          className="mt-6 w-full rounded-full bg-ink px-6 py-4 text-base text-cream transition-opacity disabled:opacity-40"
        >
          {submitting
            ? "Processing…"
            : needsReaderChoice
              ? "Pick a reader above to continue"
              : useTerminal
                ? `Charge on reader & ${reserving ? "reserve" : "check out"} · ${money(totalAfterCredit)}`
                : `Collect payment & ${reserving ? "reserve" : "check out"} · ${money(totalAfterCredit)}`}
        </button>
        <p className="mt-2 text-center text-xs text-ink/40">
          {reserving
            ? `Future pickup (${fmtShort(startDate)}): this is a reservation — full payment now holds the piece, and it's marked picked up when they come in. Refundable (rental price) up to 48 hours before pickup.`
            : useTerminal
              ? "Creates the order, then prompts the customer to tap their card on the reader."
              : "Payment is collected on the card reader; this records the transaction and marks pieces Rented Out."}
        </p>
      </div>

      {/* Condition disclosure — flaws must be shown to the customer first */}
      {disclosePiece && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 px-5"
          onClick={() => setDisclosePiece(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[12px] font-semibold uppercase tracking-[0.15em] text-blush-deep">
              ⚠️ Condition — show the customer
            </p>
            <h2 className="mt-2 font-serif text-2xl font-medium">
              {disclosePiece.brand} has a noted condition
            </h2>
            <div className="mt-3 whitespace-pre-line rounded-2xl border border-blush/50 bg-blush/10 p-4 text-[15px] leading-relaxed text-ink">
              {disclosableCondition(disclosePiece)}
            </div>
            <p className="mt-3 text-[14px] text-ink/60">
              Point this out to the customer and make sure they still want to take it.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setDisclosePiece(null)}
                className="flex-1 rounded-full border border-ink/20 px-5 py-3 text-[15px] text-ink/60"
              >
                Don&apos;t add it
              </button>
              <button
                onClick={() => {
                  const it = disclosePiece;
                  setAckedDisclosures((s) => {
                    const n = new Set(s);
                    n.add(it.id);
                    return n;
                  });
                  setSelectedIds((prev) =>
                    prev.includes(it.id) ? prev : [...prev, it.id]
                  );
                  setDisclosePiece(null);
                  beep(true);
                }}
                className="flex-1 rounded-full bg-ink px-5 py-3 text-[15px] text-cream"
              >
                They still want it — add
              </button>
            </div>
          </div>
        </div>
      )}

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
                  reader to pay {money(totalAfterCredit)}.
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
