"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { AmbassadorProgram, DEFAULT_PROGRAM } from "@/lib/types";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

// Local copy (avoids importing the server-only lib/dropoff into the client).
type DropoffConfig = {
  open_days: number[];
  open_time: string;
  close_time: string;
  slot_minutes: number;
  closed_dates: string[];
};
const DEFAULT_DROPOFF: DropoffConfig = {
  open_days: [1, 2, 3, 4, 5, 6],
  open_time: "10:00",
  close_time: "18:00",
  slot_minutes: 15,
  closed_dates: [],
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SettingsPage() {
  const [program, setProgram] = useState<AmbassadorProgram>(DEFAULT_PROGRAM);
  const [dropoff, setDropoff] = useState<DropoffConfig>(DEFAULT_DROPOFF);
  const [closedDate, setClosedDate] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [readers, setReaders] = useState<
    {
      id: string;
      label: string | null;
      device_type: string;
      status: string;
      location: string | null;
      location_name: string | null;
    }[]
  >([]);
  const [readerMsg, setReaderMsg] = useState("");
  const [readerBusy, setReaderBusy] = useState(false);

  async function loadReaders() {
    setReaderBusy(true);
    setReaderMsg("");
    try {
      const res = await fetch("/api/stripe/terminal/readers");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't list readers");
      setReaders(d.readers || []);
      if ((d.readers || []).length === 0)
        setReaderMsg("No readers registered yet. Register a test reader to try the flow.");
    } catch (e) {
      setReaderMsg((e as Error).message);
    }
    setReaderBusy(false);
  }

  async function registerSimulated() {
    setReaderBusy(true);
    setReaderMsg("");
    try {
      const res = await fetch("/api/stripe/terminal/readers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register_simulated" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't register a test reader");
      setProgram((p) => ({ ...p, terminal_reader_id: d.reader_id }));
      setReaderMsg(`Test reader registered: ${d.reader_id}. Save settings to use it.`);
      loadReaders();
    } catch (e) {
      setReaderMsg((e as Error).message);
    }
    setReaderBusy(false);
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const d = await res.json();
        setProgram(d.program);
        if (d.dropoff) setDropoff(d.dropoff);
      }
      setLoaded(true);
    })();
  }, []);

  function setCredit(
    tier: "curator" | "poster",
    field: "free" | "rate",
    value: string
  ) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setProgram((p) => ({
      ...p,
      credits: { ...p.credits, [tier]: { ...p.credits[tier], [field]: n } },
    }));
  }

  function addDate() {
    const d = newDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    setProgram((p) => ({
      ...p,
      blackout_dates: Array.from(new Set([...p.blackout_dates, d])).sort(),
    }));
    setNewDate("");
  }
  function removeDate(d: string) {
    setProgram((p) => ({
      ...p,
      blackout_dates: p.blackout_dates.filter((x) => x !== d),
    }));
  }

  async function save() {
    setSaving(true);
    setSavedAt(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ program, dropoff }),
    });
    if (res.ok) {
      const d = await res.json();
      setProgram(d.program);
      if (d.dropoff) setDropoff(d.dropoff);
      setSavedAt(true);
    }
    setSaving(false);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="text-4xl font-medium md:text-5xl">Settings</h1>
        <p className="mt-1.5 text-sm text-ink/50">Ambassador perk program</p>

        {!loaded ? (
          <div className="mt-8 h-64 animate-pulse rounded-2xl bg-ink/5" />
        ) : (
          <>
            {/* Monthly credit allowances */}
            <section className="mt-8 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Monthly credits per ambassador
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Reset on the 1st of each month.
              </p>
              {(["curator", "poster"] as const).map((tier) => (
                <div key={tier} className="mt-4">
                  <p className="mb-1.5 text-[15px] font-medium capitalize">{tier}s</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Free rentals</label>
                      <input
                        type="number"
                        min={0}
                        className={inputCls}
                        value={program.credits[tier].free}
                        onChange={(e) => setCredit(tier, "free", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>$-rate rentals</label>
                      <input
                        type="number"
                        min={0}
                        className={inputCls}
                        value={program.credits[tier].rate}
                        onChange={(e) => setCredit(tier, "rate", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Cleaning &amp; Care Fee ($ / paying rental)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.cleaning_fee}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        cleaning_fee: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Ambassador $-rate ($ / cleaning cost)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.cleaning_rate}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        cleaning_rate: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="mt-4 max-w-[16rem]">
                <label className={labelCls}>Cleaning / turnaround buffer (days)</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={program.turnaround_days}
                  onChange={(e) =>
                    setProgram((p) => ({
                      ...p,
                      turnaround_days: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    }))
                  }
                />
                <p className="mt-1 text-[12px] text-ink/45">
                  Days a piece is held after each return before it can be booked
                  again. Shows as a &quot;cleaning hold&quot; on the calendar.
                </p>
              </div>
              <p className="mt-3 text-[12px] text-ink/45">
                Curators also earn +1 bonus free credit each time a piece they proposed is accepted.
              </p>
              <div className="mt-4 max-w-[14rem]">
                <label className={labelCls}>Post store credit ($ / posted rental)</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={program.post_credit}
                  onChange={(e) =>
                    setProgram((p) => ({
                      ...p,
                      post_credit: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    }))
                  }
                />
                <p className="mt-1 text-[12px] text-ink/45">
                  Credit a customer earns when they post a rental; auto-applies at their next checkout.
                </p>
              </div>
            </section>

            {/* Missing-item fees */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Missing-item fees
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Charged to the renter&apos;s card on file if a hanger or garment
                bag isn&apos;t returned. Shown at checkout.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Missing hanger fee ($)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.hanger_fee}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        hanger_fee: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Missing garment bag fee ($)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.garment_bag_fee}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        garment_bag_fee: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
              </div>
            </section>

            {/* Drop-off appointment window */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Drop-off appointments
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Hours and closed days for consignors booking a drop-off on the shop.
                Slots outside these never show.
              </p>
              <div className="mt-3">
                <label className={labelCls}>Open days</label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => {
                    const on = dropoff.open_days.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          setDropoff((p) => ({
                            ...p,
                            open_days: on
                              ? p.open_days.filter((x) => x !== i)
                              : [...p.open_days, i].sort((a, b) => a - b),
                          }))
                        }
                        className={`rounded-full border px-3.5 py-2 text-sm ${
                          on ? "border-ink bg-ink text-cream" : "border-ink/15 bg-white text-ink/60"
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Opens</label>
                  <input
                    type="time"
                    className={inputCls}
                    value={dropoff.open_time}
                    onChange={(e) => setDropoff((p) => ({ ...p, open_time: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Closes</label>
                  <input
                    type="time"
                    className={inputCls}
                    value={dropoff.close_time}
                    onChange={(e) => setDropoff((p) => ({ ...p, close_time: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Slot length</label>
                  <select
                    className={inputCls}
                    value={dropoff.slot_minutes}
                    onChange={(e) =>
                      setDropoff((p) => ({ ...p, slot_minutes: Number(e.target.value) }))
                    }
                  >
                    {[10, 15, 20, 30, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className={labelCls}>Closed days (no drop-offs)</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    className={inputCls}
                    value={closedDate}
                    onChange={(e) => setClosedDate(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(closedDate)) return;
                      setDropoff((p) => ({
                        ...p,
                        closed_dates: Array.from(
                          new Set([...p.closed_dates, closedDate])
                        ).sort(),
                      }));
                      setClosedDate("");
                    }}
                    className="shrink-0 rounded-xl bg-ink px-4 text-[15px] text-cream"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {dropoff.closed_dates.length === 0 ? (
                    <p className="text-sm text-ink/40">No closed days set.</p>
                  ) : (
                    dropoff.closed_dates.map((d) => (
                      <span
                        key={d}
                        className="flex items-center gap-1.5 rounded-full bg-blush/40 px-3 py-1 text-sm"
                      >
                        {d}
                        <button
                          onClick={() =>
                            setDropoff((p) => ({
                              ...p,
                              closed_dates: p.closed_dates.filter((x) => x !== d),
                            }))
                          }
                          className="text-ink/40 hover:text-ink"
                          aria-label="Remove closed day"
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </section>

            {/* Posting target */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Posting target</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Posts expected per ambassador each month. Pace-based: an ambassador is
                flagged &quot;Behind&quot; when they fall below the expected pace for how far
                into the month it is.
              </p>
              <div className="mt-3 max-w-[10rem]">
                <label className={labelCls}>Posts / month</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={program.posting_target}
                  onChange={(e) =>
                    setProgram((p) => ({
                      ...p,
                      posting_target: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    }))
                  }
                />
              </div>
            </section>

            {/* Blackout dates */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Peak blackout dates
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                On these days, ambassador free/$-rate perks don&apos;t apply — full price is
                charged and paying customers are prioritized.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="date"
                  className={inputCls}
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                <button
                  onClick={addDate}
                  className="shrink-0 rounded-xl bg-ink px-4 text-[15px] text-cream"
                >
                  Add
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {program.blackout_dates.length === 0 ? (
                  <p className="text-sm text-ink/40">No blackout dates set.</p>
                ) : (
                  program.blackout_dates.map((d) => (
                    <span
                      key={d}
                      className="flex items-center gap-1.5 rounded-full bg-blush/40 px-3 py-1 text-sm"
                    >
                      {d}
                      <button
                        onClick={() => removeDate(d)}
                        className="text-ink/40 hover:text-ink"
                        aria-label="Remove date"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </section>

            {/* In-person card reader */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                In-person card reader
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Paste your Stripe Terminal reader ID (starts with{" "}
                <span className="font-mono">tmr_</span>). When set, checkout collects
                payment by tapping the reader — no typing cards. Leave blank to keep
                using the card-on-file field.
              </p>
              <input
                className={`${inputCls} mt-3 font-mono`}
                placeholder="tmr_…"
                value={program.terminal_reader_id}
                onChange={(e) =>
                  setProgram((p) => ({ ...p, terminal_reader_id: e.target.value.trim() }))
                }
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadReaders}
                  disabled={readerBusy}
                  className="rounded-full border border-ink/15 px-4 py-1.5 text-sm text-ink/70 disabled:opacity-40"
                >
                  List my readers
                </button>
                <button
                  type="button"
                  onClick={registerSimulated}
                  disabled={readerBusy}
                  className="rounded-full border border-ink/15 px-4 py-1.5 text-sm text-ink/70 disabled:opacity-40"
                >
                  Register a test reader
                </button>
              </div>
              {readers.length > 0 && (
                <div className="mt-3 space-y-3">
                  {Object.entries(
                    readers.reduce<Record<string, typeof readers>>((groups, r) => {
                      const key = r.location_name || "No location";
                      (groups[key] ||= []).push(r);
                      return groups;
                    }, {})
                  ).map(([loc, group]) => (
                    <div key={loc}>
                      <p className="mb-1 text-[11px] uppercase tracking-[0.15em] text-ink/40">
                        {loc}
                      </p>
                      <div className="space-y-1.5">
                        {group.map((r) => {
                          const selected = program.terminal_reader_id === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() =>
                                setProgram((p) => ({ ...p, terminal_reader_id: r.id }))
                              }
                              className={`block w-full rounded-xl border px-3.5 py-2 text-left text-sm ${
                                selected
                                  ? "border-ink bg-ink text-cream"
                                  : "border-ink/10 bg-white hover:bg-cream"
                              }`}
                            >
                              <span className="font-medium">
                                {r.label || r.device_type}
                              </span>
                              <span className={selected ? "text-cream/70" : "text-ink/50"}>
                                {" "}
                                · {r.status}
                                {selected ? " · selected" : ""}
                              </span>
                              <span
                                className={`mt-0.5 block font-mono text-[12px] ${
                                  selected ? "text-cream/60" : "text-ink/40"
                                }`}
                              >
                                {r.id}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {readerMsg && (
                <p className="mt-2 text-[13px] text-ink/60">{readerMsg}</p>
              )}
            </section>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
              {savedAt && <span className="text-sm text-sage-deep">Saved ✓</span>}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
