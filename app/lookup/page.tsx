"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { fromISO, addDays, toISO, todayISO, fmtShort, fmtWeekday } from "@/lib/dates";

type Booking = {
  id: number;
  status: "reserved" | "active";
  start_date: string;
  due_date: string;
  customer_name: string | null;
};
type PieceInfo = {
  id: string;
  barcode: string;
  name: string;
  brand: string;
  size: string;
  color: string | null;
  photo_url: string | null;
  status: string;
};
type LookupData = { item: PieceInfo; bookings: Booking[]; buffer: number };

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// Per-day state for the looked-up piece, using the app's established colors:
// rented out = blush, reserved = lavender, cleaning/buffer = butter.
type DayCell = { kind: "active" | "reserved" | "buffer"; booking: Booking };
const RANK = { active: 3, reserved: 2, buffer: 1 } as const;

export default function LookupPage() {
  const [barcode, setBarcode] = useState("");
  const [data, setData] = useState<LookupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(() => {
    const n = fromISO(todayISO());
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const today = todayISO();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    setLoading(true);
    setError("");
    setSelectedDay(null);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(code)}/bookings`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setData(d);
      } else {
        setData(null);
        setError(d.error || "Couldn't look that up — try again.");
      }
    } catch {
      setData(null);
      setError("Couldn't reach the studio — check your connection.");
    } finally {
      setLoading(false);
      // Keep the field ready for the next scan/entry.
      setBarcode("");
      inputRef.current?.focus();
    }
  }

  // Map each day → the piece's state that day (active beats reserved beats buffer).
  const dayMap = useMemo(() => {
    const map: Record<string, DayCell> = {};
    if (!data) return map;
    const put = (day: string, cell: DayCell) => {
      const cur = map[day];
      if (!cur || RANK[cell.kind] > RANK[cur.kind]) map[day] = cell;
    };
    for (const b of data.bookings) {
      // The rental window itself, inclusive.
      let d = b.start_date;
      for (let i = 0; i < 400 && d <= b.due_date; i++) {
        put(d, { kind: b.status, booking: b });
        d = addDays(d, 1);
      }
      // Cleaning/turnaround hold after the return — not bookable.
      for (let k = 1; k <= data.buffer; k++) {
        put(addDays(b.due_date, k), { kind: "buffer", booking: b });
      }
    }
    return map;
  }, [data]);

  const gridDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startPad = first.getDay(); // 0 = Sunday
    const start = new Date(first);
    start.setDate(first.getDate() - startPad);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return toISO(d);
    });
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const sel = selectedDay ? dayMap[selectedDay] : undefined;

  const cellColor = (kind: DayCell["kind"]) =>
    kind === "active"
      ? "bg-blush"
      : kind === "reserved"
        ? "bg-lavender"
        : "bg-butter";

  const KIND_LABEL = { active: "Rented out", reserved: "Reserved", buffer: "Cleaning hold" };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Look up piece</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Scan or type a barcode to see that piece&apos;s reservation calendar.
          Viewing only — nothing here checks anything out.
        </p>

        {/* Barcode input — stays focused/ready for the next scan */}
        <form onSubmit={lookup} className="mt-5 flex gap-2">
          <input
            ref={inputRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Scan or type a barcode…"
            inputMode="numeric"
            autoFocus
            className="w-full rounded-full border border-ink/15 bg-white px-5 py-3 font-mono text-base outline-none focus:border-ink/40"
          />
          <button
            type="submit"
            disabled={loading || !barcode.trim()}
            className="shrink-0 rounded-full bg-ink px-6 py-3 text-[15px] text-cream disabled:opacity-40"
          >
            {loading ? "…" : "Look up"}
          </button>
        </form>

        {error && <p className="mt-4 text-sm text-blush-deep">{error}</p>}

        {data && (
          <>
            {/* Piece header */}
            <div className="mt-6 flex items-center gap-3">
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                {data.item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.item.photo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
                    {data.item.name.charAt(0)}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-medium">{data.item.name}</p>
                <p className="text-[13px] text-ink/55">
                  <span className="font-mono">{data.item.barcode}</span> · {data.item.size}
                  {data.item.color ? ` · ${data.item.color}` : ""} ·{" "}
                  {data.bookings.length} upcoming booking
                  {data.bookings.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-ink/60">
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded bg-lavender" /> Reserved
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded bg-blush" /> Rented out
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded bg-butter" /> Cleaning hold
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded border border-ink/15 bg-white" /> Open
              </span>
            </div>

            {/* Month calendar */}
            <div className="mt-4 overflow-hidden rounded-2xl border border-ink/10 bg-white">
              <div className="flex items-center justify-between px-4 py-3">
                <button
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                  className="rounded-full px-3 py-1 text-lg leading-none text-ink/50 hover:bg-cream"
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <span className="font-serif text-xl font-medium">{monthLabel}</span>
                <button
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                  className="rounded-full px-3 py-1 text-lg leading-none text-ink/50 hover:bg-cream"
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
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
                  const cell = dayMap[day];
                  const isToday = day === today;
                  const isSel = day === selectedDay;
                  const title = cell
                    ? `${KIND_LABEL[cell.kind]}${cell.booking.customer_name ? ` — ${cell.booking.customer_name}` : ""}${cell.kind !== "buffer" ? ` · due ${cell.booking.due_date}` : ""}`
                    : "Open";
                  return (
                    <button
                      key={day}
                      title={title}
                      onClick={() => setSelectedDay(isSel ? null : day)}
                      className={`relative min-h-14 border-b border-r border-ink/5 p-1.5 text-left align-top transition-colors sm:min-h-16 ${
                        inMonth ? "" : "opacity-40"
                      } ${isSel ? "ring-2 ring-ink/40" : ""}`}
                    >
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[13px] ${
                          isToday ? "bg-ink text-cream" : ""
                        }`}
                      >
                        {fromISO(day).getDate()}
                      </span>
                      {cell && inMonth && (
                        <span
                          className={`mt-0.5 block h-1.5 w-full rounded-full ${cellColor(cell.kind)}`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tapped-day detail (read-only) */}
            {selectedDay && (
              <div className="mt-4 rounded-2xl bg-lavender/25 p-4">
                <h3 className="text-lg font-medium">{fmtWeekday(selectedDay)}</h3>
                {sel ? (
                  <p className="mt-1 text-sm text-ink/70">
                    <span
                      className={`mr-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] ${cellColor(sel.kind)}`}
                    >
                      {KIND_LABEL[sel.kind]}
                    </span>
                    {sel.booking.customer_name ?? "No customer"}
                    {sel.kind !== "buffer" && (
                      <>
                        {" "}· out {fmtShort(sel.booking.start_date)} → due{" "}
                        {fmtShort(sel.booking.due_date)}
                      </>
                    )}
                    {sel.kind === "buffer" && " · cleaning/turnaround, not bookable"}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-ink/50">Open — no reservation this day.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
