"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { fmtShort, dateOnly } from "@/lib/dates";

type Appt = {
  id: number;
  slot_date: string;
  slot_time: string;
  name: string;
  phone: string | null;
  email: string | null;
  item_count: number;
  customer_id: number | null;
  consignor_id: number | null;
  customer_name: string | null;
  consignor_name: string | null;
};

function prettyTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export default function DropoffPage() {
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const [reschedId, setReschedId] = useState<number | null>(null);
  const [rDate, setRDate] = useState("");
  const [rSlots, setRSlots] = useState<string[] | null>(null);
  const [rSlot, setRSlot] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/dropoff");
    if (res.ok) setAppts(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  // Load open slots when choosing a new time for a reschedule.
  useEffect(() => {
    if (!rDate) {
      setRSlots(null);
      return;
    }
    setRSlots(null);
    setRSlot("");
    fetch(`/api/dropoff?date=${rDate}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((d) => setRSlots(d.slots || []))
      .catch(() => setRSlots([]));
  }, [rDate]);

  async function cancel(id: number) {
    const res = await fetch(`/api/dropoff/${id}`, { method: "DELETE" });
    if (res.ok) {
      setAppts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
      setConfirmCancel(null);
    }
  }

  async function complete(id: number) {
    const res = await fetch(`/api/dropoff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    if (res.ok) {
      setAppts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    }
  }

  function startReschedule(id: number) {
    setReschedId(id);
    setRDate("");
    setRSlot("");
    setConfirmCancel(null);
  }

  async function submitReschedule(id: number) {
    if (!rDate || !rSlot) return;
    setBusy(true);
    const res = await fetch(`/api/dropoff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: rDate, time: rSlot }),
    });
    if (res.ok) {
      const u = await res.json();
      setAppts((prev) =>
        prev
          ? prev
              .map((a) =>
                a.id === id ? { ...a, slot_date: u.slot_date, slot_time: u.slot_time } : a
              )
              .sort((a, b) =>
                (a.slot_date + a.slot_time).localeCompare(b.slot_date + b.slot_time)
              )
          : prev
      );
      setReschedId(null);
      setRDate("");
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Couldn't reschedule.");
      if (rDate) {
        fetch(`/api/dropoff?date=${rDate}`)
          .then((r) => r.json())
          .then((x) => setRSlots(x.slots || []))
          .catch(() => {});
        setRSlot("");
      }
    }
    setBusy(false);
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (appts ?? []).filter((a) => dateOnly(a.slot_date) >= today);
  const past = (appts ?? []).filter((a) => dateOnly(a.slot_date) < today);

  // Group upcoming by date for clean day headers.
  const byDate = new Map<string, Appt[]>();
  for (const a of upcoming) {
    const d = dateOnly(a.slot_date);
    const arr = byDate.get(d);
    if (arr) arr.push(a);
    else byDate.set(d, [a]);
  }

  function Row({ a }: { a: Appt }) {
    const linked = a.consignor_name
      ? `Consignor · ${a.consignor_name}`
      : a.customer_name
        ? `Customer · ${a.customer_name}`
        : "New to Borrow";
    return (
      <div className="rounded-2xl bg-white p-3.5">
        <div className="flex items-start gap-3">
          <div className="w-20 shrink-0 text-center">
            <p className="font-serif text-lg font-semibold">{prettyTime(a.slot_time)}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">
              {a.name}{" "}
              <span className="text-ink/50">
                · {a.item_count} item{a.item_count === 1 ? "" : "s"}
              </span>
            </p>
            <p className="truncate text-[13px] text-ink/55">
              {a.phone || "no phone"}
              {a.email ? ` · ${a.email}` : ""}
            </p>
            <p className="text-[12px] text-ink/45">{linked}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <button
              onClick={() => complete(a.id)}
              className="rounded-full border border-sage-deep bg-sage px-3 py-1.5 text-[12px] text-ink"
            >
              Completed
            </button>
            <button
              onClick={() => startReschedule(a.id)}
              className="rounded-full border border-ink/15 px-3 py-1.5 text-[12px] text-ink/60"
            >
              Reschedule
            </button>
            {confirmCancel === a.id ? (
              <button
                onClick={() => cancel(a.id)}
                className="rounded-full border border-blush-deep px-3 py-1.5 text-[12px] text-blush-deep"
              >
                Cancel it?
              </button>
            ) : (
              <button
                onClick={() => setConfirmCancel(a.id)}
                className="rounded-full px-3 py-1.5 text-[12px] text-ink/40"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {reschedId === a.id && (
          <div className="mt-3 rounded-xl bg-cream p-3.5">
            <p className="mb-2 text-[13px] text-ink/60">Move to a new day &amp; time:</p>
            <input
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={rDate}
              onChange={(e) => setRDate(e.target.value)}
              className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none"
            />
            {rDate && (
              <div className="mt-2">
                {rSlots === null ? (
                  <p className="text-[13px] text-ink/45">Loading times…</p>
                ) : rSlots.length === 0 ? (
                  <p className="text-[13px] text-ink/55">No openings that day.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {rSlots.map((s) => (
                      <button
                        key={s}
                        onClick={() => setRSlot(s)}
                        className={`rounded-full border px-1 py-2 text-[12px] ${
                          rSlot === s
                            ? "border-ink bg-ink text-cream"
                            : "border-ink/15 bg-white text-ink/70"
                        }`}
                      >
                        {prettyTime(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => submitReschedule(a.id)}
                disabled={busy || !rSlot}
                className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40"
              >
                {busy ? "Saving…" : "Confirm new time"}
              </button>
              <button
                onClick={() => setReschedId(null)}
                className="rounded-full px-4 py-2 text-[13px] text-ink/50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="text-4xl font-medium md:text-5xl">Drop-off appointments</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          {upcoming.length} upcoming · set hours &amp; closed days in Settings
        </p>

        {appts === null ? (
          <div className="mt-8 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white p-5 text-sm text-ink/45">
            No upcoming drop-offs booked.
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            {Array.from(byDate.entries()).map(([d, list]) => (
              <section key={d}>
                <h2 className="mb-2 text-xl font-medium">{fmtShort(d)}</h2>
                <div className="space-y-2">
                  {list.map((a) => (
                    <Row key={a.id} a={a} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-medium text-ink/50">Past</h2>
            <div className="mt-2 space-y-2 opacity-60">
              {past.slice(0, 15).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-2xl bg-white/60 p-3 text-[13px]"
                >
                  <span className="w-28 shrink-0 text-ink/50">
                    {fmtShort(dateOnly(a.slot_date))} · {prettyTime(a.slot_time)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {a.name} · {a.item_count} item{a.item_count === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
