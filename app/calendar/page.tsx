"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import BookingForm from "@/components/BookingForm";
import { Item, Customer, Rental } from "@/lib/types";
import {
  toISO,
  todayISO,
  fromISO,
  addDays,
  fmtShort,
  fmtWeekday,
  dateOnly,
} from "@/lib/dates";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function monthRange(cursor: Date): { from: string; to: string } {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return { from: toISO(first), to: toISO(last) };
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [buffer, setBuffer] = useState(0); // cleaning/turnaround days after a return

  const today = todayISO();

  // Load bookings for the visible month — and keep them fresh so rentals
  // made from the customer site show up without a manual reload.
  useEffect(() => {
    const { from, to } = monthRange(cursor);
    let alive = true;
    async function load() {
      const res = await fetch(`/api/rentals?from=${from}&to=${to}`);
      if (res.ok && alive) setRentals(await res.json());
      if (alive) setLoaded(true);
    }
    load();
    const interval = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [cursor]);

  useEffect(() => {
    (async () => {
      const [ir, cr] = await Promise.all([
        fetch("/api/items"),
        fetch("/api/customers"),
      ]);
      if (ir.ok) setItems(await ir.json());
      if (cr.ok) setCustomers(await cr.json());
      const sr = await fetch("/api/settings");
      if (sr.ok) {
        const s = await sr.json();
        if (s.program?.turnaround_days != null) setBuffer(Number(s.program.turnaround_days));
      }
    })();
  }, []);

  // 6-week grid starting the Sunday on/before the 1st
  const gridDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = addDays(toISO(first), -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const byDay = useMemo(() => {
    const map: Record<
      string,
      { pickups: Rental[]; returns: Rental[]; buffer: Rental[] }
    > = {};
    const at = (day: string) =>
      (map[day] ??= { pickups: [], returns: [], buffer: [] });
    for (const r of rentals) {
      if (r.status === "cancelled") continue;
      const s = dateOnly(r.start_date);
      const d = dateOnly(r.due_date);
      at(s).pickups.push(r);
      at(d).returns.push(r);
      // The days after a return are a cleaning/turnaround hold — not bookable.
      for (let k = 1; k <= buffer; k++) at(addDays(d, k)).buffer.push(r);
    }
    return map;
  }, [rentals, buffer]);

  const outNow = useMemo(
    () =>
      rentals
        .filter((r) => r.status === "active")
        .sort((a, b) => dateOnly(a.due_date).localeCompare(dateOnly(b.due_date))),
    [rentals]
  );
  const upcoming = useMemo(
    () =>
      rentals
        .filter((r) => r.status === "reserved" && dateOnly(r.start_date) >= today)
        .sort((a, b) =>
          dateOnly(a.start_date).localeCompare(dateOnly(b.start_date))
        )
        .slice(0, 8),
    [rentals, today]
  );

  async function act(rental: Rental, action: "pickup" | "cancel") {
    if (action === "cancel" && !window.confirm("Cancel this booking?")) return;
    setBusyId(rental.id);
    const res = await fetch(`/api/rentals/${rental.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      const updated: Rental = await res.json();
      setRentals((prev) =>
        prev.map((r) => (r.id === updated.id ? updated : r))
      );
    }
    setBusyId(null);
  }

  function monthLabel() {
    return cursor.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  const selected = selectedDay ? byDay[selectedDay] : null;

  function RentalRow({ r, kind }: { r: Rental; kind: "pickup" | "return" }) {
    const overdue =
      r.status === "active" && dateOnly(r.due_date) < today;
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white p-3">
        <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
          {r.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.photo_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
              {r.brand?.charAt(0)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]">
            <span className="font-serif font-semibold">{r.brand}</span>{" "}
            <span className="text-ink/50">
              {r.item_id} · {r.size}
            </span>
          </p>
          <p className="truncate text-[13px] text-ink/55">
            {r.customer_name ?? "No customer"} ·{" "}
            {fmtShort(dateOnly(r.start_date))} –{" "}
            {fmtShort(dateOnly(r.due_date))}
            {overdue && (
              <span className="ml-1.5 rounded-full bg-blush px-2 py-0.5 text-[11px] font-medium">
                overdue
              </span>
            )}
          </p>
        </div>
        {kind === "pickup" && r.status === "reserved" && (
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => act(r, "pickup")}
              disabled={busyId === r.id}
              className="rounded-full bg-ink px-3.5 py-2 text-[13px] text-cream disabled:opacity-40"
            >
              Picked up
            </button>
            <button
              onClick={() => act(r, "cancel")}
              disabled={busyId === r.id}
              className="rounded-full border border-ink/15 px-3 py-2 text-[13px] text-ink/50 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        )}
        {kind === "pickup" && r.status === "active" && (
          <span className="shrink-0 rounded-full bg-blush px-2.5 py-1 text-[11px]">
            out
          </span>
        )}
        {kind === "pickup" && r.status === "completed" && (
          <span className="shrink-0 rounded-full bg-ink/10 px-2.5 py-1 text-[11px] text-ink/50">
            done
          </span>
        )}
        {kind === "return" && r.status === "active" && (
          <span className="shrink-0 rounded-full bg-butter px-2.5 py-1 text-[11px]">
            due back
          </span>
        )}
        {kind === "return" && r.status === "completed" && (
          <span className="shrink-0 rounded-full bg-sage px-2.5 py-1 text-[11px]">
            returned
          </span>
        )}
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-medium md:text-5xl">Calendar</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              {outNow.length} out now ·{" "}
              {rentals.filter((r) => r.status === "reserved").length} reserved
            </p>
          </div>
          <button
            onClick={() => setBookingOpen(true)}
            className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-transform active:scale-[0.98]"
          >
            + New booking
          </button>
        </div>

        {/* Month nav */}
        <div className="mt-7 flex items-center gap-2">
          <button
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
            }
            className="rounded-full bg-white px-3.5 py-2 text-ink/60 hover:bg-ink/5"
            aria-label="Previous month"
          >
            ‹
          </button>
          <h2 className="min-w-44 text-center text-2xl font-medium">
            {monthLabel()}
          </h2>
          <button
            onClick={() =>
              setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
            }
            className="rounded-full bg-white px-3.5 py-2 text-ink/60 hover:bg-ink/5"
            aria-label="Next month"
          >
            ›
          </button>
          <button
            onClick={() => {
              const n = new Date();
              setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
              setSelectedDay(todayISO());
            }}
            className="ml-1 rounded-full px-3.5 py-2 text-sm text-ink/50 hover:bg-ink/5"
          >
            Today
          </button>
          <div className="ml-auto hidden items-center gap-3 text-xs text-ink/50 sm:flex">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sage" /> pickup
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blush" /> return
            </span>
            {buffer > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-butter" /> cleaning hold
              </span>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-ink/10 bg-white">
          <div className="grid grid-cols-7 border-b border-ink/10">
            {WEEKDAYS.map((w, i) => (
              <div
                key={i}
                className="py-2 text-center text-[11px] uppercase tracking-widest text-ink/40"
              >
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {gridDays.map((day) => {
              const inMonth = fromISO(day).getMonth() === cursor.getMonth();
              const ev = byDay[day];
              const nPick = ev?.pickups.length ?? 0;
              const nRet = ev?.returns.length ?? 0;
              const nBuf = ev?.buffer.length ?? 0;
              const isToday = day === today;
              const isSelected = day === selectedDay;
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  className={`relative min-h-16 border-b border-r border-ink/5 p-1.5 text-left align-top transition-colors sm:min-h-20 ${
                    inMonth ? "" : "bg-cream/60 text-ink/30"
                  } ${isSelected ? "bg-lavender/30" : "hover:bg-cream/70"}`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] ${
                      isToday ? "bg-ink text-cream" : ""
                    }`}
                  >
                    {fromISO(day).getDate()}
                  </span>
                  {(nPick > 0 || nRet > 0 || nBuf > 0) && (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {nPick > 0 && (
                        <span className="rounded-full bg-sage px-1.5 py-0.5 text-[10px] leading-none">
                          ↑{nPick}
                        </span>
                      )}
                      {nRet > 0 && (
                        <span className="rounded-full bg-blush px-1.5 py-0.5 text-[10px] leading-none">
                          ↓{nRet}
                        </span>
                      )}
                      {nBuf > 0 && (
                        <span className="rounded-full bg-butter px-1.5 py-0.5 text-[10px] leading-none text-ink/70">
                          ⟳{nBuf}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected day detail */}
        {selectedDay && (
          <div className="mt-5 rounded-2xl bg-lavender/25 p-4 sm:p-5">
            <h3 className="text-xl font-medium">{fmtWeekday(selectedDay)}</h3>
            {!selected ||
            (selected.pickups.length === 0 &&
              selected.returns.length === 0 &&
              selected.buffer.length === 0) ? (
              <p className="mt-2 text-sm text-ink/50">
                Nothing scheduled this day.{" "}
                <button
                  onClick={() => setBookingOpen(true)}
                  className="underline underline-offset-2"
                >
                  Book something
                </button>
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {selected.pickups.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.15em] text-ink/50">
                      Pickups
                    </p>
                    <div className="space-y-2">
                      {selected.pickups.map((r) => (
                        <RentalRow key={`p${r.id}`} r={r} kind="pickup" />
                      ))}
                    </div>
                  </div>
                )}
                {selected.returns.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.15em] text-ink/50">
                      Returns due
                    </p>
                    <div className="space-y-2">
                      {selected.returns.map((r) => (
                        <RentalRow key={`r${r.id}`} r={r} kind="return" />
                      ))}
                    </div>
                  </div>
                )}
                {selected.buffer.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.15em] text-ink/50">
                      Cleaning hold — not bookable
                    </p>
                    <div className="space-y-2">
                      {selected.buffer.map((r) => (
                        <div
                          key={`b${r.id}`}
                          className="flex items-center gap-3 rounded-2xl bg-butter/40 p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px]">
                              <span className="font-serif font-semibold">{r.brand}</span>{" "}
                              <span className="text-ink/50">
                                {r.item_id} · {r.size}
                              </span>
                            </p>
                            <p className="text-[13px] text-ink/55">
                              Turnaround after return {fmtShort(dateOnly(r.due_date))}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-butter px-2.5 py-1 text-[11px]">
                            cleaning hold
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Out now + upcoming */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="text-2xl font-medium">Out now</h3>
            <div className="mt-3 space-y-2">
              {!loaded ? (
                <div className="h-20 animate-pulse rounded-2xl bg-ink/5" />
              ) : outNow.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                  Nothing is out right now.
                </p>
              ) : (
                outNow.map((r) => <RentalRow key={r.id} r={r} kind="return" />)
              )}
            </div>
          </section>
          <section>
            <h3 className="text-2xl font-medium">Upcoming pickups</h3>
            <div className="mt-3 space-y-2">
              {!loaded ? (
                <div className="h-20 animate-pulse rounded-2xl bg-ink/5" />
              ) : upcoming.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                  No reservations on the books — yet.
                </p>
              ) : (
                upcoming.map((r) => <RentalRow key={r.id} r={r} kind="pickup" />)
              )}
            </div>
          </section>
        </div>
      </div>

      {bookingOpen && (
        <BookingForm
          items={items}
          customers={customers}
          rentals={rentals}
          defaultDate={selectedDay ?? undefined}
          onClose={() => setBookingOpen(false)}
          onBooked={(r) => {
            setRentals((prev) => [...prev, r]);
            setItems((prev) =>
              prev.map((i) =>
                i.id === r.item_id && i.status === "available"
                  ? { ...i, status: "reserved" }
                  : i
              )
            );
            setBookingOpen(false);
          }}
          onCustomerAdded={(c) =>
            setCustomers((prev) =>
              [...prev, c].sort((a, b) => a.name.localeCompare(b.name))
            )
          }
        />
      )}
    </AppShell>
  );
}
