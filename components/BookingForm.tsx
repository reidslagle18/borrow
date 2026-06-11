"use client";

import { useMemo, useState } from "react";
import { Item, Customer, Rental } from "@/lib/types";
import { addDays, todayISO, fmtShort, dateOnly } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

export default function BookingForm({
  items,
  customers,
  rentals,
  defaultDate,
  onClose,
  onBooked,
  onCustomerAdded,
}: {
  items: Item[];
  customers: Customer[];
  rentals: Rental[];
  defaultDate?: string;
  onClose: () => void;
  onBooked: (rental: Rental) => void;
  onCustomerAdded: (c: Customer) => void;
}) {
  const [itemId, setItemId] = useState("");
  const [customerId, setCustomerId] = useState<number | "">("");
  const [startDate, setStartDate] = useState(defaultDate ?? todayISO());
  const [dueDate, setDueDate] = useState(
    addDays(defaultDate ?? todayISO(), 7)
  );
  const [dueTouched, setDueTouched] = useState(false);
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [waiver, setWaiver] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncPhone, setNcPhone] = useState("");

  const bookable = useMemo(
    () => items.filter((i) => i.status !== "retired"),
    [items]
  );

  function pickItem(id: string) {
    setItemId(id);
    const item = items.find((i) => i.id === id);
    if (item && !priceTouched) setPrice(String(Number(item.rental_price)));
  }

  function pickStart(d: string) {
    setStartDate(d);
    if (!dueTouched && d) setDueDate(addDays(d, 7));
  }

  const conflict = useMemo(() => {
    if (!itemId || !startDate || !dueDate) return null;
    return (
      rentals.find(
        (r) =>
          r.item_id === itemId &&
          (r.status === "reserved" || r.status === "active") &&
          dateOnly(r.start_date) <= dueDate &&
          dateOnly(r.due_date) >= startDate
      ) ?? null
    );
  }, [itemId, startDate, dueDate, rentals]);

  async function addCustomer() {
    if (!ncName.trim()) return;
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: ncName.trim(), phone: ncPhone.trim() }),
    });
    if (res.ok) {
      const c: Customer = await res.json();
      onCustomerAdded(c);
      setCustomerId(c.id);
      setShowNewCustomer(false);
      setNcName("");
      setNcPhone("");
    }
  }

  async function save() {
    if (!itemId || !startDate || !dueDate || price === "") {
      setError("Pick a piece, dates and a price.");
      return;
    }
    if (conflict) {
      setError("This piece is already booked for those dates.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/rentals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: itemId,
        customer_id: customerId === "" ? null : customerId,
        start_date: startDate,
        due_date: dueDate,
        rental_price: Number(price),
        damage_waiver: waiver,
        notes: notes.trim(),
      }),
    });
    if (res.ok) {
      const r: Rental = await res.json();
      const item = items.find((i) => i.id === r.item_id);
      r.customer_name =
        customers.find((c) => c.id === r.customer_id)?.name ?? null;
      if (item) {
        r.brand = item.brand;
        r.size = item.size;
        r.color = item.color;
        r.photo_url = item.photo_url;
      }
      onBooked(r);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't book — try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between">
          <h2 className="text-3xl font-medium">New booking</h2>
          <button
            onClick={onClose}
            className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Piece *</label>
            <select
              className={inputCls}
              value={itemId}
              onChange={(e) => pickItem(e.target.value)}
            >
              <option value="">Select a piece</option>
              {bookable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.brand} · {i.id} · {i.size}
                  {i.color ? ` · ${i.color}` : ""} · ${Number(i.rental_price)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Customer</label>
            <select
              className={inputCls}
              value={customerId}
              onChange={(e) =>
                setCustomerId(
                  e.target.value === "" ? "" : Number(e.target.value)
                )
              }
            >
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ""}
                </option>
              ))}
            </select>
            {!showNewCustomer ? (
              <button
                type="button"
                onClick={() => setShowNewCustomer(true)}
                className="mt-2 text-xs uppercase tracking-widest text-ink/50 underline-offset-2 hover:underline"
              >
                + New customer
              </button>
            ) : (
              <div className="mt-3 space-y-2 rounded-2xl bg-lavender/30 p-3.5">
                <input
                  className={inputCls}
                  placeholder="Name"
                  value={ncName}
                  onChange={(e) => setNcName(e.target.value)}
                />
                <input
                  className={inputCls}
                  placeholder="Phone (optional)"
                  value={ncPhone}
                  onChange={(e) => setNcPhone(e.target.value)}
                />
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Pickup *</label>
              <input
                type="date"
                className={inputCls}
                value={startDate}
                onChange={(e) => pickStart(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Due back *</label>
              <input
                type="date"
                className={inputCls}
                value={dueDate}
                min={startDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setDueTouched(true);
                }}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-ink/45">
            Standard window is 7 days — late returns run $15/day.
          </p>

          {conflict && (
            <p className="rounded-xl bg-blush/30 px-3.5 py-2.5 text-sm text-ink">
              Already booked {fmtShort(dateOnly(conflict.start_date))} –{" "}
              {fmtShort(dateOnly(conflict.due_date))}
              {conflict.customer_name ? ` for ${conflict.customer_name}` : ""}.
              Pick different dates.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Price ($) *</label>
              <input
                type="number"
                inputMode="decimal"
                className={inputCls}
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPriceTouched(true);
                }}
                placeholder="From piece"
              />
            </div>
            <div>
              <label className={labelCls}>Damage waiver ($5)</label>
              <button
                type="button"
                onClick={() => setWaiver(!waiver)}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-[15px] ${
                  waiver
                    ? "border-sage-deep bg-sage text-ink"
                    : "border-ink/15 bg-white text-ink/50"
                }`}
              >
                {waiver ? "Added" : "No waiver"}
              </button>
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <input
              className={inputCls}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Formal at Ole Miss, needs it by Friday…"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-blush-deep">{error}</p>}

        <button
          onClick={save}
          disabled={saving || !!conflict}
          className="mt-6 w-full rounded-full bg-ink px-6 py-3.5 text-base text-cream transition-opacity disabled:opacity-40"
        >
          {saving ? "Booking…" : "Book it"}
        </button>
      </div>
    </div>
  );
}
