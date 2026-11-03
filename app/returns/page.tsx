"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { Item, Rental } from "@/lib/types";
import { todayISO, fmtShort, dateOnly } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

function daysLate(due: string, returned: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(returned) - Date.parse(due)) / 86_400_000)
  );
}

function Thumb({ url, brand }: { url: string | null | undefined; brand?: string }) {
  return (
    <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
          {brand?.charAt(0)}
        </div>
      )}
    </div>
  );
}

function CheckInModal({
  rental,
  force = false,
  onClose,
  onDone,
}: {
  rental: Rental;
  force?: boolean;
  onClose: () => void;
  onDone: (updated: Rental) => void;
}) {
  const due = dateOnly(rental.due_date);
  const [returnedDate, setReturnedDate] = useState(todayISO());
  const [issue, setIssue] = useState<"none" | "repair" | "loss">("none");
  const [repairCost, setRepairCost] = useState("");
  const [damageNote, setDamageNote] = useState("");
  const [feeOverride, setFeeOverride] = useState<string | null>(null);
  const [hangerMissing, setHangerMissing] = useState(false);
  const [hangerFee, setHangerFee] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const replacementValue = Number(rental.item_replacement_value ?? 0);
  const isConsigned = rental.ownership === "consignment";
  const fmtMoney = (n: number) => `$${n % 1 === 0 ? n : n.toFixed(2)}`;

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.program) {
          setHangerFee(Number(d.program.hanger_fee) || 0);
        }
      })
      .catch(() => {});
  }, []);

  const late = daysLate(due, returnedDate);
  const autoFee = late * 15;
  const fee = feeOverride !== null ? feeOverride : String(autoFee);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/rentals/${rental.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "return",
          returned_date: returnedDate,
          damage_kind: issue === "none" ? undefined : issue,
          repair_cost: issue === "repair" ? Number(repairCost || 0) : undefined,
          damage_note: issue === "none" ? "" : damageNote,
          late_fee: feeOverride !== null ? Number(feeOverride || 0) : undefined,
          hanger_missing: hangerMissing,
          force: force || undefined,
        }),
      });
      if (res.ok) {
        onDone(await res.json());
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't check in — try again.");
      }
    } catch {
      setError("Couldn't reach the studio — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-3xl font-medium">Check in</h2>
            <p className="mt-1 text-sm text-ink/55">
              {rental.brand} · {rental.item_id} ·{" "}
              {rental.customer_name ?? "no customer"} · due {fmtShort(due)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {force && (
          <p className="mb-4 rounded-xl border border-butter-deep/50 bg-butter/40 px-3.5 py-2.5 text-[13px] text-ink">
            This piece was never marked picked up. Checking in here will backfill
            the pickup (with today&apos;s date) and complete the return.
          </p>
        )}

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Returned on</label>
            <input
              type="date"
              className={inputCls}
              value={returnedDate}
              onChange={(e) => {
                setReturnedDate(e.target.value);
                setFeeOverride(null);
              }}
            />
          </div>

          <div
            className={`rounded-2xl p-4 ${late > 0 ? "bg-blush/25" : "bg-sage/20"}`}
          >
            {late > 0 ? (
              <>
                <p className="text-[15px]">
                  {late} day{late === 1 ? "" : "s"} late · $15/day
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs uppercase tracking-[0.15em] text-ink/50">
                    Late fee $
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="w-24 rounded-xl border border-ink/15 bg-white px-3 py-1.5 text-[15px] outline-none"
                    value={fee}
                    onChange={(e) => setFeeOverride(e.target.value)}
                  />
                  {Number(fee) !== autoFee && (
                    <button
                      type="button"
                      onClick={() => setFeeOverride(null)}
                      className="text-xs text-ink/50 underline underline-offset-2"
                    >
                      reset to ${autoFee}
                    </button>
                  )}
                  {Number(fee) > 0 && (
                    <button
                      type="button"
                      onClick={() => setFeeOverride("0")}
                      className="ml-auto text-xs text-ink/50 underline underline-offset-2"
                    >
                      waive
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[15px]">On time — no late fee.</p>
            )}
          </div>

          <div>
            <label className={labelCls}>Condition</label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { v: "none", label: "No issue" },
                  { v: "repair", label: "Repairable" },
                  { v: "loss", label: "Total loss" },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setIssue(o.v)}
                  className={`rounded-xl border px-2 py-2.5 text-[14px] ${
                    issue === o.v
                      ? o.v === "loss"
                        ? "border-blush-deep bg-blush text-ink"
                        : "border-ink bg-ink text-cream"
                      : "border-ink/15 bg-white text-ink/60"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {issue === "repair" && (
              <div className="mt-3 space-y-2 rounded-2xl bg-butter/30 p-3.5">
                <div className="flex items-center gap-2">
                  <label className="text-xs uppercase tracking-[0.15em] text-ink/50">
                    Repair cost $
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="w-28 rounded-xl border border-ink/15 bg-white px-3 py-1.5 text-[15px] outline-none"
                    value={repairCost}
                    onChange={(e) => setRepairCost(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <p className="text-[12px] text-ink/55">
                  Charged to the renter&apos;s card on file. The piece goes to
                  cleaning/repair and stays in inventory. Consignor is not charged
                  and keeps their normal earnings.
                </p>
                <textarea
                  className={`${inputCls} min-h-16`}
                  placeholder="What needs repair? (broken zipper, hem…)"
                  value={damageNote}
                  onChange={(e) => setDamageNote(e.target.value)}
                />
              </div>
            )}

            {issue === "loss" && (
              <div className="mt-3 space-y-2 rounded-2xl bg-blush/25 p-3.5">
                <p className="text-[15px]">
                  Charge renter{" "}
                  <span className="font-semibold">{fmtMoney(replacementValue)}</span>{" "}
                  (replacement value) and retire the piece.
                </p>
                <p className="text-[12px] text-ink/60">
                  {isConsigned
                    ? `This piece is consigned — the consignor is paid the full ${fmtMoney(
                        replacementValue
                      )} on their next payout, guaranteed even if the renter's charge fails.`
                    : "Owned piece — no consignor payout."}
                </p>
                {replacementValue <= 0 && (
                  <p className="text-[12px] text-blush-deep">
                    No replacement value is set on this piece — set one on the
                    piece first so the renter can be charged.
                  </p>
                )}
                <textarea
                  className={`${inputCls} min-h-16`}
                  placeholder="What happened? (not returned, destroyed…)"
                  value={damageNote}
                  onChange={(e) => setDamageNote(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Missing hanger — charged to the saved card */}
          <div>
            <label className={labelCls}>Returned with</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px]">
                <input
                  type="checkbox"
                  checked={hangerMissing}
                  onChange={(e) => setHangerMissing(e.target.checked)}
                  className="h-4 w-4 accent-ink"
                />
                <span>
                  Hanger not returned
                  {hangerFee > 0 && (
                    <span className="text-ink/50"> · charge {fmtMoney(hangerFee)}</span>
                  )}
                </span>
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-blush-deep">{error}</p>}

          <button
            onClick={submit}
            disabled={saving || (issue === "loss" && replacementValue <= 0)}
            className="w-full rounded-full bg-ink px-6 py-3.5 text-base text-cream transition-opacity disabled:opacity-40"
          >
            {saving
              ? "Working…"
              : issue === "loss"
                ? `Record loss & charge ${fmtMoney(replacementValue)}`
                : issue === "repair"
                  ? "Charge repair & check in"
                  : "Complete check-in → cleaning"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReturnsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [recent, setRecent] = useState<Rental[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [checking, setChecking] = useState<Rental | null>(null);
  const [checkingForce, setCheckingForce] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [rackError, setRackError] = useState("");

  const today = todayISO();

  async function loadAll() {
    try {
      const [rr, rec, ir] = await Promise.all([
        fetch("/api/rentals"),
        fetch("/api/rentals?recent=1"),
        fetch("/api/items"),
      ]);
      if (!rr.ok) throw new Error(`rentals ${rr.status}`);
      setRentals(await rr.json());
      if (rec.ok) setRecent(await rec.json());
      if (ir.ok) setItems(await ir.json());
    } catch {
      setLoadError("Couldn't load returns — refresh to try again.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  async function deleteRental(rentalId: number) {
    const res = await fetch(`/api/rentals/${rentalId}`, { method: "DELETE" });
    if (res.ok) {
      setRecent((prev) => prev.filter((r) => r.id !== rentalId));
      setConfirmDelete(null);
    }
  }

  const out = useMemo(
    () =>
      rentals
        .filter((r) => r.status === "active")
        .sort((a, b) =>
          dateOnly(a.due_date).localeCompare(dateOnly(b.due_date))
        ),
    [rentals]
  );
  const overdue = out.filter((r) => dateOnly(r.due_date) < today);
  const onTime = out.filter((r) => dateOnly(r.due_date) >= today);
  const cleaning = items.filter((i) => i.status === "cleaning");
  // Reservations scheduled to be picked up TODAY — the customer is coming in to
  // collect. Staff tap "Picked up" to send it out (reserved → out on rent).
  const pickupToday = useMemo(
    () =>
      rentals
        .filter((r) => r.status === "reserved" && dateOnly(r.start_date) === today)
        .sort((a, b) => (a.customer_name ?? "").localeCompare(b.customer_name ?? "")),
    [rentals, today]
  );
  // Pieces whose pickup day has already PASSED (still 'reserved') but are still
  // within the rental window — pickup was never confirmed. Today's pickups live
  // in `pickupToday`; reservations whose RETURN date has passed are no-shows
  // (handled on the calendar). Staff can mark these Picked up (a late pickup) or
  // Force check-in (they were picked up and are being returned).
  const stuck = useMemo(
    () =>
      rentals
        .filter(
          (r) =>
            r.status === "reserved" &&
            dateOnly(r.start_date) < today &&
            dateOnly(r.due_date) >= today
        )
        .sort((a, b) => dateOnly(a.start_date).localeCompare(dateOnly(b.start_date))),
    [rentals, today]
  );

  function openCheckIn(r: Rental, isForce = false) {
    setCheckingForce(isForce);
    setChecking(r);
  }

  // Confirm a reservation was picked up: reserved → out on rent (active).
  const [busyPickup, setBusyPickup] = useState<number | null>(null);
  async function markPickedUp(r: Rental) {
    setBusyPickup(r.id);
    setRackError("");
    try {
      const res = await fetch(`/api/rentals/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pickup" }),
      });
      if (res.ok) {
        const updated = await res.json().catch(() => null);
        setRentals((prev) =>
          prev.map((x) =>
            x.id === r.id ? { ...x, ...(updated || {}), status: "active" } : x
          )
        );
        setItems((prev) =>
          prev.map((i) => (i.id === r.item_id ? { ...i, status: "rented" } : i))
        );
      } else {
        const d = await res.json().catch(() => ({}));
        setRackError(d.error || "Couldn't mark it picked up — try again.");
      }
    } catch {
      setRackError("Couldn't reach the studio — check your connection and try again.");
    } finally {
      setBusyPickup(null);
    }
  }

  function handleDone(updated: Rental) {
    setChecking(null);
    setRentals((prev) => prev.filter((r) => r.id !== updated.id));
    setRecent((prev) => [updated, ...prev].slice(0, 10));
    // A total loss retires the piece; anything else goes to cleaning.
    const newStatus = updated.damage_kind === "loss" ? "retired" : "cleaning";
    setItems((prev) =>
      prev.map((i) =>
        i.id === updated.item_id ? { ...i, status: newStatus } : i
      )
    );
  }

  async function backOnRack(item: Item) {
    setBusyItem(item.id);
    setRackError("");
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rack" }),
      });
      if (res.ok) {
        const updated: Item = await res.json();
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      } else {
        setRackError("Couldn't move the piece back — try again.");
      }
    } catch {
      setRackError("Couldn't reach the studio — check your connection and try again.");
    } finally {
      setBusyItem(null);
    }
  }

  function RentalRow({ r }: { r: Rental }) {
    const isLate = dateOnly(r.due_date) < today;
    const lateDays = isLate ? daysLate(dateOnly(r.due_date), today) : 0;
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white p-3">
        <Thumb url={r.photo_url} brand={r.brand} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]">
            <span className="font-serif font-semibold">{r.brand}</span>{" "}
            <span className="text-ink/50">
              {r.item_id} · {r.size}
            </span>
          </p>
          <p className="truncate text-[13px] text-ink/55">
            {r.customer_name ?? "No customer"} · due {fmtShort(dateOnly(r.due_date))}
            {isLate && (
              <span className="ml-1.5 rounded-full bg-blush px-2 py-0.5 text-[11px] font-medium">
                {lateDays}d late · ${lateDays * 15} so far
              </span>
            )}
          </p>
          {r.payment_followup && (
            <p className="mt-1 flex items-center gap-2 text-[12px] text-blush-deep">
              A charge to their card failed — needs follow-up.
              {r.payment_link_url && (
                <button
                  onClick={() => navigator.clipboard?.writeText(r.payment_link_url!)}
                  className="rounded-full border border-blush-deep px-2 py-0.5 text-[11px]"
                >
                  Copy pay link
                </button>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => openCheckIn(r)}
          className="shrink-0 rounded-full bg-ink px-4 py-2 text-[13px] text-cream"
        >
          Check in
        </button>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Returns</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          {out.length} out · {overdue.length} overdue · {cleaning.length} being
          cleaned
        </p>

        {!loaded ? (
          <div className="mt-8 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : (
          <>
            {pickupToday.length > 0 && (
              <section className="mt-8">
                <h2 className="text-2xl font-medium text-sage-deep">
                  Picking up today ({pickupToday.length})
                </h2>
                <p className="mt-1 text-[13px] text-ink/55">
                  Reservations scheduled for pickup today. Tap{" "}
                  <strong>Picked up</strong> when the customer collects it.
                </p>
                <div className="mt-3 space-y-2">
                  {pickupToday.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-2xl border border-sage-deep/40 bg-sage/20 p-3"
                    >
                      <Thumb url={r.photo_url} brand={r.brand} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">{r.brand}</span>{" "}
                          <span className="text-ink/50">
                            {r.item_id} · {r.size}
                          </span>
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          {r.customer_name ?? "No customer"} · due back{" "}
                          {fmtShort(dateOnly(r.due_date))}
                        </p>
                      </div>
                      <button
                        onClick={() => markPickedUp(r)}
                        disabled={busyPickup === r.id}
                        className="shrink-0 rounded-full border border-sage-deep bg-sage px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-40"
                      >
                        {busyPickup === r.id ? "…" : "Picked up"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {stuck.length > 0 && (
              <section className="mt-8">
                <h2 className="text-2xl font-medium text-butter-deep">
                  Pickup not confirmed
                </h2>
                <p className="mt-1 text-[13px] text-ink/55">
                  Reserved, pickup day has passed, but pickup was never marked. If
                  the customer is picking up now, tap <strong>Picked up</strong>.
                  If it was already picked up and is being returned, use{" "}
                  <strong>Force check-in</strong>.
                </p>
                <div className="mt-3 space-y-2">
                  {stuck.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-2xl border border-butter-deep/40 bg-butter/25 p-3"
                    >
                      <Thumb url={r.photo_url} brand={r.brand} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">{r.brand}</span>{" "}
                          <span className="text-ink/50">
                            {r.item_id} · {r.size}
                          </span>
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          {r.customer_name ?? "No customer"} · pickup was{" "}
                          {fmtShort(dateOnly(r.start_date))} · due{" "}
                          {fmtShort(dateOnly(r.due_date))}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => markPickedUp(r)}
                          disabled={busyPickup === r.id}
                          className="rounded-full border border-sage-deep bg-sage px-3.5 py-2 text-[13px] font-medium text-ink disabled:opacity-40"
                        >
                          {busyPickup === r.id ? "…" : "Picked up"}
                        </button>
                        <button
                          onClick={() => openCheckIn(r, true)}
                          className="rounded-full border border-ink px-3 py-2 text-[13px] text-ink/70"
                        >
                          Force check-in
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {overdue.length > 0 && (
              <section className="mt-8">
                <h2 className="text-2xl font-medium text-blush-deep">
                  Overdue
                </h2>
                <div className="mt-3 space-y-2">
                  {overdue.map((r) => (
                    <RentalRow key={r.id} r={r} />
                  ))}
                </div>
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-2xl font-medium">Out now</h2>
              <div className="mt-3 space-y-2">
                {onTime.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    Nothing else is out.
                  </p>
                ) : (
                  onTime.map((r) => <RentalRow key={r.id} r={r} />)
                )}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-2xl font-medium">Being cleaned</h2>
              {rackError && <p className="mt-2 text-sm text-blush-deep">{rackError}</p>}
              <div className="mt-3 space-y-2">
                {cleaning.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    The cleaning rack is clear.
                  </p>
                ) : (
                  cleaning.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-center gap-3 rounded-2xl bg-white p-3"
                    >
                      <Thumb url={i.photo_url} brand={i.brand} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">
                            {i.brand}
                          </span>{" "}
                          <span className="text-ink/50">
                            {i.id} · {i.size}
                          </span>
                        </p>
                        <p className="truncate text-[12px] text-ink/50">
                          Barcode{" "}
                          <span className="font-mono text-ink/70">
                            {i.barcode || "—"}
                          </span>
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          {i.condition_notes
                            ? i.condition_notes.split("\n").pop()
                            : "Being cleaned"}
                        </p>
                      </div>
                      <button
                        onClick={() => backOnRack(i)}
                        disabled={busyItem === i.id}
                        className="shrink-0 rounded-full border border-sage-deep bg-sage px-4 py-2 text-[13px] text-ink disabled:opacity-40"
                      >
                        Back on rack
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            {recent.length > 0 && (
              <section className="mt-8">
                <h2 className="text-2xl font-medium">Recently returned</h2>
                <div className="mt-3 space-y-2">
                  {recent.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-2xl bg-white/60 p-3"
                    >
                      <Thumb url={r.photo_url} brand={r.brand} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">
                            {r.brand}
                          </span>{" "}
                          <span className="text-ink/50">
                            {r.item_id} · {r.customer_name ?? "no customer"}
                          </span>
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          returned{" "}
                          {r.returned_date
                            ? fmtShort(dateOnly(r.returned_date))
                            : ""}
                          {Number(r.late_fee) > 0 &&
                            ` · $${Number(r.late_fee)} late fee`}
                          {r.damage_kind === "loss"
                            ? " · total loss"
                            : r.damaged
                              ? " · damaged"
                              : ""}
                        </p>
                        {r.payment_followup && (
                          <p className="mt-1 flex items-center gap-2 text-[12px] text-blush-deep">
                            Replacement uncollected — renter charge failed.
                            {r.payment_link_url && (
                              <button
                                onClick={() =>
                                  navigator.clipboard?.writeText(r.payment_link_url!)
                                }
                                className="rounded-full border border-blush-deep px-2 py-0.5 text-[11px]"
                              >
                                Copy pay link
                              </button>
                            )}
                          </p>
                        )}
                      </div>
                      {r.damage_kind === "loss" ? (
                        <span className="shrink-0 rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">
                          total loss
                        </span>
                      ) : r.damaged ? (
                        <span className="shrink-0 rounded-full bg-blush px-2.5 py-1 text-[11px]">
                          damaged
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-sage px-2.5 py-1 text-[11px]">
                          ok
                        </span>
                      )}
                      {confirmDelete === r.id ? (
                        <button
                          onClick={() => deleteRental(r.id)}
                          className="shrink-0 rounded-full border border-blush-deep px-2.5 py-1 text-[11px] text-blush-deep"
                        >
                          Delete?
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(r.id)}
                          className="shrink-0 rounded-full px-2 text-lg leading-none text-ink/30 hover:bg-ink/5"
                          aria-label="Delete return"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {checking && (
        <CheckInModal
          rental={checking}
          force={checkingForce}
          onClose={() => setChecking(null)}
          onDone={handleDone}
        />
      )}
    </AppShell>
  );
}
