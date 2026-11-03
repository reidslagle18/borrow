"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { AmbassadorProgram, DEFAULT_PROGRAM, RENTAL_DAYS } from "@/lib/types";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

// Local copy (avoids importing the server-only lib/dropoff into the client).
type DayHours = { open: string; close: string };
type DropoffConfig = {
  open_days: number[];
  open_time: string;
  close_time: string;
  slot_minutes: number;
  closed_dates: string[];
  start_date: string;
  day_hours: Record<string, DayHours>;
};
const DEFAULT_DROPOFF: DropoffConfig = {
  open_days: [1, 2, 3, 4, 5, 6],
  open_time: "10:00",
  close_time: "18:00",
  slot_minutes: 45,
  closed_dates: [],
  start_date: "",
  day_hours: {},
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SettingsPage() {
  const [program, setProgram] = useState<AmbassadorProgram>(DEFAULT_PROGRAM);
  const [dropoff, setDropoff] = useState<DropoffConfig>(DEFAULT_DROPOFF);
  const [closedDate, setClosedDate] = useState("");
  const [storeClosedDate, setStoreClosedDate] = useState("");
  const [newSwatchName, setNewSwatchName] = useState("");
  const [newSwatchHex, setNewSwatchHex] = useState("#cccccc");
  const [newOccasionName, setNewOccasionName] = useState("");
  const [subInput, setSubInput] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [saveError, setSaveError] = useState("");
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
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error(`settings ${res.status}`);
        const d = await res.json();
        setProgram(d.program);
        if (d.dropoff) setDropoff(d.dropoff);
        setLoaded(true);
      } catch {
        // Don't show the form with defaults — saving them would overwrite
        // the real settings. Show an error panel instead.
        setLoadError("Couldn't load settings — refresh to try again.");
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    setSavedAt(false);
    setSaveError("");
    try {
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
      } else {
        setSaveError("Couldn't save settings — try again.");
      }
    } catch {
      setSaveError("Couldn't reach the studio — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Settings</h1>
        <p className="mt-1.5 text-sm text-ink/50">Studio configuration</p>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded ? (
          <div className="mt-8 h-64 animate-pulse rounded-2xl bg-ink/5" />
        ) : (
          <>
            {/* Rental fees & timing */}
            <section className="mt-8 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Rental fees &amp; timing
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Consignor dry-clean charge ($)</label>
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
                  <p className="mt-1 text-[12px] text-ink/45">
                    Charged to a consignor only for an optional initial or
                    at-retrieval dry clean. Renters are never charged a separate
                    fee — the Cleaning &amp; Care Fee is already included in every
                    rental price.
                  </p>
                </div>
                <div>
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
                </div>
                <div>
                  <label className={labelCls}>Reservation protection window (days)</label>
                  <input
                    type="number"
                    min={1}
                    className={inputCls}
                    value={program.reservation_protect_days}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        reservation_protect_days: Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                  <p className="mt-1 text-[12px] text-ink/45">
                    A reserved piece stops accepting new rentals this many days
                    before its pickup, so it&apos;s guaranteed back, cleaned, and
                    ready. Currently {program.reservation_protect_days} days.
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Consignor hold reminder lead (days)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.hold_notice_lead_days}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        hold_notice_lead_days: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                  <p className="mt-1 text-[12px] text-ink/45">
                    When a consignor asks a piece back, it shows in Needs Attention
                    this many days before their start date (a reminder to pull it).
                    It appears immediately if the hold conflicts with a paying
                    reservation. Currently {program.hold_notice_lead_days} day
                    {program.hold_notice_lead_days === 1 ? "" : "s"}.
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Retrieval Cleaning Fee ($)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.retrieval_cleaning_fee}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        retrieval_cleaning_fee: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                  <p className="mt-1 text-[12px] text-ink/45">
                    Deducted from a consignor&apos;s earnings when they get a piece
                    back, since we clean it first. Shown to them before they
                    confirm.
                  </p>
                </div>
              </div>
              <p className="mt-1.5 text-[12px] text-ink/45">
                Turnaround = days a piece is held after each return before it can
                be booked again (shows as a &quot;cleaning hold&quot; on the calendar).
              </p>
            </section>

            {/* Consignor approval notifications */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Consignor approval emails
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                When you add a consignor&apos;s pieces, they&apos;re emailed
                automatically to review and approve them. Pieces added within this
                window are grouped into a single email instead of one per item.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Batch window (minutes)</label>
                  <input
                    type="number"
                    min={1}
                    className={inputCls}
                    value={program.approval_batch_window_min}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        approval_batch_window_min: Math.max(
                          1,
                          Math.floor(Number(e.target.value) || 0)
                        ),
                      }))
                    }
                  />
                </div>
              </div>
              <p className="mt-1.5 text-[12px] text-ink/45">
                The email goes out once this window passes from the first new
                piece. Pieces added later start a fresh batch with its own email.
                Lower this for faster emails; you can always re-send from a
                consignor&apos;s record.
              </p>
            </section>

            {/* Underperforming-item pickup + storage windows */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Underperforming pieces
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                A consignment piece is flagged &quot;Underperforming&quot; when it
                hasn&apos;t rented within this many days of being listed, or of its
                last rental. You always approve before any pickup notice is sent.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Underperformance threshold (days)</label>
                  <input
                    type="number"
                    min={1}
                    className={inputCls}
                    value={program.underperformance_days}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        underperformance_days: Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Storage window (days)</label>
                  <input
                    type="number"
                    min={1}
                    className={inputCls}
                    value={program.storage_window_days}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        storage_window_days: Math.max(1, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
              </div>
              <p className="mt-1.5 text-[12px] text-ink/45">
                After an approved pickup notice, a consignor has 30 days to collect
                before the piece moves to storage. The storage window is how long a
                stored piece stays retrievable before it&apos;s flagged for your
                final decision (never auto-disposed).
              </p>
            </section>

            {/* Missing-item fees */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Missing-item fees
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Charged to the renter&apos;s card on file if the hanger
                isn&apos;t returned. Shown at checkout.
              </p>
              <div className="mt-3 max-w-[12rem]">
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
            </section>

            {/* Color swatches — free-text color name → hex for the shop filter */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Color swatches</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                The little color squares shoppers see in the Color filter. Any
                color name not listed here shows a neutral gray square until you
                add its hex. Names are matched ignoring case.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(program.color_swatches || {})
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, hex]) => (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded-full border border-ink/15 bg-white py-1 pl-1.5 pr-2 text-[13px]"
                    >
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#cccccc"}
                        onChange={(e) =>
                          setProgram((p) => ({
                            ...p,
                            color_swatches: { ...p.color_swatches, [name]: e.target.value },
                          }))
                        }
                        className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                        aria-label={`${name} color`}
                      />
                      <span className="capitalize">{name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setProgram((p) => {
                            const next = { ...p.color_swatches };
                            delete next[name];
                            return { ...p, color_swatches: next };
                          })
                        }
                        className="text-ink/35 hover:text-ink"
                        aria-label={`Remove ${name}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={newSwatchName}
                  onChange={(e) => setNewSwatchName(e.target.value)}
                  placeholder="Color name (e.g. dusty rose)"
                  className="min-w-0 flex-1 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm outline-none focus:border-ink/40"
                />
                <input
                  type="color"
                  value={newSwatchHex}
                  onChange={(e) => setNewSwatchHex(e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-ink/15 bg-transparent p-0.5"
                  aria-label="New color hex"
                />
                <button
                  type="button"
                  onClick={() => {
                    const name = newSwatchName.trim().toLowerCase();
                    if (!name) return;
                    setProgram((p) => ({
                      ...p,
                      color_swatches: { ...p.color_swatches, [name]: newSwatchHex },
                    }));
                    setNewSwatchName("");
                    setNewSwatchHex("#cccccc");
                  }}
                  className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm text-cream"
                >
                  Add color
                </button>
              </div>
              <p className="mt-2 text-[12px] text-ink/40">
                Remember to <strong>Save</strong> at the bottom. Changes appear on
                the shop&apos;s Color filter.
              </p>
            </section>

            {/* Occasions — the shop's "Shop by Occasion" pills + their subs */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Shop by Occasion</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Occasions shoppers browse by on the storefront. Each can have its
                own sub-filters (e.g. Vacation → Beach, Poolside). Tag pieces with
                these on each piece, or in bulk from Inventory. Reorder-free: they
                show in the order below.
              </p>
              <div className="mt-3 space-y-3">
                {(program.occasions ?? []).map((occ, idx) => (
                  <div key={occ.name} className="rounded-2xl border border-ink/10 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[15px]">{occ.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() =>
                            setProgram((p) => {
                              const list = [...p.occasions];
                              [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
                              return { ...p, occasions: list };
                            })
                          }
                          className="rounded-full px-2 py-1 text-ink/40 hover:text-ink disabled:opacity-25"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={idx === (program.occasions?.length ?? 0) - 1}
                          onClick={() =>
                            setProgram((p) => {
                              const list = [...p.occasions];
                              [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]];
                              return { ...p, occasions: list };
                            })
                          }
                          className="rounded-full px-2 py-1 text-ink/40 hover:text-ink disabled:opacity-25"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setProgram((p) => ({
                              ...p,
                              occasions: p.occasions.filter((o) => o.name !== occ.name),
                            }))
                          }
                          className="rounded-full px-2 py-1 text-ink/35 hover:text-blush-deep"
                          aria-label={`Remove ${occ.name}`}
                        >
                          × remove
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {occ.subs.map((s) => (
                        <span
                          key={s}
                          className="flex items-center gap-1 rounded-full bg-blush/40 px-2.5 py-1 text-[12px]"
                        >
                          {s}
                          <button
                            type="button"
                            onClick={() =>
                              setProgram((p) => ({
                                ...p,
                                occasions: p.occasions.map((o) =>
                                  o.name === occ.name
                                    ? { ...o, subs: o.subs.filter((x) => x !== s) }
                                    : o
                                ),
                              }))
                            }
                            className="text-ink/40 hover:text-ink"
                            aria-label={`Remove ${s}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        value={subInput[occ.name] ?? ""}
                        onChange={(e) =>
                          setSubInput((m) => ({ ...m, [occ.name]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const sub = (subInput[occ.name] ?? "").trim();
                            if (!sub) return;
                            setProgram((p) => ({
                              ...p,
                              occasions: p.occasions.map((o) =>
                                o.name === occ.name && !o.subs.includes(sub)
                                  ? { ...o, subs: [...o.subs, sub] }
                                  : o
                              ),
                            }));
                            setSubInput((m) => ({ ...m, [occ.name]: "" }));
                          }
                        }}
                        placeholder="+ sub-filter, Enter"
                        className="min-w-32 rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px] outline-none focus:border-ink/40"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={newOccasionName}
                  onChange={(e) => setNewOccasionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const name = newOccasionName.trim();
                      if (!name) return;
                      setProgram((p) =>
                        p.occasions.some((o) => o.name.toLowerCase() === name.toLowerCase())
                          ? p
                          : { ...p, occasions: [...p.occasions, { name, subs: [] }] }
                      );
                      setNewOccasionName("");
                    }
                  }}
                  placeholder="New occasion (e.g. Brunch)"
                  className="min-w-0 flex-1 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm outline-none focus:border-ink/40"
                />
                <button
                  type="button"
                  onClick={() => {
                    const name = newOccasionName.trim();
                    if (!name) return;
                    setProgram((p) =>
                      p.occasions.some((o) => o.name.toLowerCase() === name.toLowerCase())
                        ? p
                        : { ...p, occasions: [...p.occasions, { name, subs: [] }] }
                    );
                    setNewOccasionName("");
                  }}
                  className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm text-cream"
                >
                  Add occasion
                </button>
              </div>
              <p className="mt-2 text-[12px] text-ink/40">
                Remember to <strong>Save</strong> at the bottom. Changes appear on
                the shop&apos;s &ldquo;Shop by Occasion&rdquo; pills and the
                per-piece tagging options.
              </p>
            </section>

            {/* Sales tax */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Sales tax</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Applied to the rental price at checkout (in-store &amp; online).
                Set to 0 to turn off. Track what you&apos;ve collected on the
                Finances page.
              </p>
              <div className="mt-3 max-w-[12rem]">
                <label className={labelCls}>Sales tax rate (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.001"
                  className={inputCls}
                  value={program.sales_tax_rate}
                  onChange={(e) =>
                    setProgram((p) => ({
                      ...p,
                      sales_tax_rate: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                />
                <p className="mt-1 text-[12px] text-ink/45">
                  e.g. Fayetteville is around 9.75% — confirm your exact combined rate.
                </p>
              </div>
            </section>

            {/* Reservations launch date */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Reservations open</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                The earliest pickup date customers can book on the shop. Reserve
                pages won&apos;t allow (or charge for) a pickup before this date.
                Leave blank to accept pickups any day.
              </p>
              <div className="mt-3 max-w-[14rem]">
                <label className={labelCls}>Earliest pickup date</label>
                <input
                  type="date"
                  className={inputCls}
                  value={program.reservations_open || ""}
                  onChange={(e) =>
                    setProgram((p) => ({ ...p, reservations_open: e.target.value }))
                  }
                />
                {program.reservations_open && (
                  <button
                    type="button"
                    className="mt-1.5 text-[12px] text-ink/45 underline hover:text-ink/70"
                    onClick={() =>
                      setProgram((p) => ({ ...p, reservations_open: "" }))
                    }
                  >
                    Clear (open pickups any day)
                  </button>
                )}
              </div>

              <div className="mt-6">
                <label className={labelCls}>Studio closed days</label>
                <p className="mb-2 text-[13px] text-ink/50">
                  Days the studio is closed. No pickup, reservation, or return can
                  land on these days, online or in-store.
                </p>
                <div className="flex max-w-md gap-2">
                  <input
                    type="date"
                    className={inputCls}
                    value={storeClosedDate}
                    onChange={(e) => setStoreClosedDate(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(storeClosedDate)) return;
                      setProgram((p) => ({
                        ...p,
                        store_closed_dates: Array.from(
                          new Set([...(p.store_closed_dates || []), storeClosedDate])
                        ).sort(),
                      }));
                      setStoreClosedDate("");
                    }}
                    className="shrink-0 rounded-full bg-ink px-4 text-[15px] text-cream"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(program.store_closed_dates || []).length === 0 ? (
                    <p className="text-sm text-ink/40">No closed days set.</p>
                  ) : (
                    (program.store_closed_dates || []).map((d) => (
                      <span
                        key={d}
                        className="flex items-center gap-1.5 rounded-full bg-blush/40 px-3 py-1 text-sm"
                      >
                        {d}
                        <button
                          onClick={() =>
                            setProgram((p) => ({
                              ...p,
                              store_closed_dates: (p.store_closed_dates || []).filter(
                                (x) => x !== d
                              ),
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

              <div className="mt-6">
                <label className={labelCls}>Closed every week on</label>
                <p className="mb-2 text-[13px] text-ink/50">
                  Recurring weekly closures. No pickup, reservation, or return can
                  land on these weekdays, online or in-store — a due date that
                  falls on one rolls to the next open day at no charge.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((lbl, i) => {
                    const on = (program.store_closed_weekdays || []).includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          setProgram((p) => {
                            const cur = p.store_closed_weekdays || [];
                            return {
                              ...p,
                              store_closed_weekdays: cur.includes(i)
                                ? cur.filter((x) => x !== i)
                                : [...cur, i].sort((a, b) => a - b),
                            };
                          })
                        }
                        className={`rounded-full border px-3.5 py-1.5 text-[13px] ${
                          on
                            ? "border-blush-deep bg-blush/50 text-ink"
                            : "border-ink/15 bg-white text-ink/60"
                        }`}
                      >
                        {lbl}
                      </button>
                    );
                  })}
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
              {/* Per-day hours: each day has its own open/close, or is closed */}
              <div className="mt-3 space-y-2">
                <label className={labelCls}>Weekly hours</label>
                {DAYS.map((d, i) => {
                  const on = dropoff.open_days.includes(i);
                  const h = dropoff.day_hours?.[String(i)] ?? {
                    open: dropoff.open_time,
                    close: dropoff.close_time,
                  };
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDropoff((p) => {
                            const isOn = p.open_days.includes(i);
                            if (isOn) {
                              return { ...p, open_days: p.open_days.filter((x) => x !== i) };
                            }
                            const dh = { ...(p.day_hours || {}) };
                            if (!dh[String(i)])
                              dh[String(i)] = { open: p.open_time, close: p.close_time };
                            return {
                              ...p,
                              open_days: [...p.open_days, i].sort((a, b) => a - b),
                              day_hours: dh,
                            };
                          })
                        }
                        className={`w-14 shrink-0 rounded-full border py-2 text-sm ${
                          on
                            ? "border-ink bg-ink text-cream"
                            : "border-ink/15 bg-white text-ink/50"
                        }`}
                      >
                        {d}
                      </button>
                      {on ? (
                        <div className="flex items-center gap-2 text-[13px] text-ink/55">
                          <input
                            type="time"
                            className="rounded-xl border border-ink/15 bg-white px-2.5 py-2 text-[14px] outline-none focus:border-ink/40"
                            value={h.open}
                            onChange={(e) =>
                              setDropoff((p) => {
                                const dh = { ...(p.day_hours || {}) };
                                dh[String(i)] = { ...(dh[String(i)] ?? h), open: e.target.value };
                                return { ...p, day_hours: dh };
                              })
                            }
                          />
                          <span>to</span>
                          <input
                            type="time"
                            className="rounded-xl border border-ink/15 bg-white px-2.5 py-2 text-[14px] outline-none focus:border-ink/40"
                            value={h.close}
                            onChange={(e) =>
                              setDropoff((p) => {
                                const dh = { ...(p.day_hours || {}) };
                                dh[String(i)] = { ...(dh[String(i)] ?? h), close: e.target.value };
                                return { ...p, day_hours: dh };
                              })
                            }
                          />
                        </div>
                      ) : (
                        <span className="text-[13px] text-ink/35">Closed</span>
                      )}
                    </div>
                  );
                })}
                <p className="text-[12px] text-ink/45">
                  Toggle a day on or off, and set each open day&apos;s own hours.
                  To block just part of a day, shorten its hours instead of closing
                  it.
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Slot length</label>
                  <select
                    className={inputCls}
                    value={dropoff.slot_minutes}
                    onChange={(e) =>
                      setDropoff((p) => ({ ...p, slot_minutes: Number(e.target.value) }))
                    }
                  >
                    {[10, 15, 20, 30, 45, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Drop-offs start date</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={dropoff.start_date || ""}
                    onChange={(e) =>
                      setDropoff((p) => ({ ...p, start_date: e.target.value }))
                    }
                  />
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
                    className="shrink-0 rounded-full bg-ink px-4 text-[15px] text-cream"
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
              {saveError && <span className="text-sm text-blush-deep">{saveError}</span>}
            </div>

            <CampaignsSection />
          </>
        )}
      </div>
    </AppShell>
  );
}

type CampaignRow = {
  id: number;
  code: string;
  label: string | null;
  organization: string;
  donation_rate: number;
  starts_on: string | null;
  ends_on: string | null;
  active: boolean;
};

/** Edit give-back / donation campaigns (code, org, rate, dates, active). Saves
 *  independently of the program settings above. */
function CampaignsSection() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(d?.campaigns ?? []))
      .catch(() => {});
  }, []);

  function edit(i: number, patch: Partial<CampaignRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function saveRow(r: CampaignRow) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/campaigns", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r),
      });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? `Saved ${r.code} ✓` : d.error || "Couldn't save.");
    } catch {
      setMsg("Couldn't reach the studio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
      <h2 className="font-serif text-xl italic text-ink/70">Give-back campaigns</h2>
      <p className="mt-1 text-[13px] text-ink/50">
        A tag-only code (no discount, no price change). Orders paid within the
        dates can carry the code; a % of their rental sales is owed as a donation.
      </p>
      <div className="mt-4 space-y-4">
        {rows.length === 0 && <p className="text-[13px] text-ink/45">No campaigns yet.</p>}
        {rows.map((r, i) => (
          <div key={r.id} className="rounded-xl border border-ink/10 bg-white p-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">Code</label>
                <input className={`${inputCls} uppercase`} value={r.code} onChange={(e) => edit(i, { code: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">Organization</label>
                <input className={inputCls} value={r.organization} onChange={(e) => edit(i, { organization: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">Note label</label>
                <input className={inputCls} value={r.label ?? ""} onChange={(e) => edit(i, { label: e.target.value })} placeholder="Renting for the Fight" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">Donation rate (%)</label>
                <input type="number" min={0} max={100} step="0.5" className={inputCls} value={r.donation_rate} onChange={(e) => edit(i, { donation_rate: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">Start date</label>
                <input type="date" className={inputCls} value={r.starts_on ?? ""} onChange={(e) => edit(i, { starts_on: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink/45">End date</label>
                <input type="date" className={inputCls} value={r.ends_on ?? ""} onChange={(e) => edit(i, { ends_on: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <label className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" checked={r.active} onChange={(e) => edit(i, { active: e.target.checked })} className="h-4 w-4 accent-ink" />
                Active
              </label>
              <button onClick={() => saveRow(r)} disabled={busy} className="rounded-full bg-ink px-5 py-2 text-[13px] text-cream disabled:opacity-40">
                {busy ? "Saving…" : "Save campaign"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {msg && <p className="mt-2 text-[13px] text-ink/60">{msg}</p>}
    </section>
  );
}
