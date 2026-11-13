"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtWeekday, fmtShort, todayISO, addDays, fromISO, toISO } from "@/lib/dates";
import { prettyRange, WEEKDAY_NAMES } from "@/lib/team-shared";

// ---- Types (match the existing API responses) ------------------------------

type Member = { id: number; name: string; ical_token: string | null };

type Shift = { date: string; start_time: string; end_time: string; is_training: boolean };
type Coverage = { date: string; member_name: string | null; is_training: boolean; mine: boolean };
type ShiftsData = { member: Member | null; upcoming: Shift[]; coverage: Coverage[] };

type UnavailableDate = { id: number; the_date: string; note: string | null };
type AvailData = { member: Member | null; weekly: Record<number, boolean>; dates: UnavailableDate[] };

type TimeOffReq = {
  id: number;
  start_date: string;
  end_date: string;
  note: string | null;
  status: string;
  decided_note: string | null;
};
type TimeOffData = { member: { id: number; name: string } | null; requests: TimeOffReq[] };

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type TabKey = "shifts" | "availability" | "timeoff";

// Friendly empty state shown whenever an endpoint returns member:null.
function NotSetUp() {
  return (
    <div className="mt-6 rounded-2xl bg-white p-6 text-center">
      <p className="text-[15px] text-ink/60">
        Your schedule profile isn&apos;t set up yet — ask the owner to finish your setup.
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
      ))}
    </div>
  );
}

export default function MyShiftsPage() {
  // Logged-in context isn't strictly needed for rendering, but we call useMe so
  // AppShell's auth bounce behaves consistently with the rest of the studio.
  useMe();
  const [tab, setTab] = useState<TabKey>("shifts");

  const TABS: { key: TabKey; label: string }[] = [
    { key: "shifts", label: "My shifts" },
    { key: "availability", label: "Availability" },
    { key: "timeoff", label: "Time off" },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">My shifts</h1>
        <p className="mt-1.5 text-sm text-ink/50">Your schedule, availability, and time off</p>

        {/* In-page tab switcher */}
        <div className="mt-5 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-[14px] transition-colors ${
                tab === t.key ? "bg-ink text-cream" : "bg-white text-ink/60 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "shifts" && <ShiftsTab />}
        {tab === "availability" && <AvailabilityTab />}
        {tab === "timeoff" && <TimeOffTab />}
      </div>
    </AppShell>
  );
}

// ---- My shifts -------------------------------------------------------------

function ShiftsTab() {
  const [data, setData] = useState<ShiftsData | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/my-shifts");
      setData(r.ok ? await r.json() : { member: null, upcoming: [], coverage: [] });
    } catch {
      setData({ member: null, upcoming: [], coverage: [] });
    }
  }, []);

  useEffect(() => {
    load();
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, [load]);

  const member = data?.member ?? null;
  const upcoming = data?.upcoming ?? [];
  const coverage = data?.coverage ?? [];

  // Who's working for the next 14 days: one row per covered date.
  const next14 = useMemo(() => {
    const today = todayISO();
    const end = addDays(today, 14);
    const byDate = new Map<string, Coverage[]>();
    for (const c of coverage) {
      if (c.date < today || c.date > end) continue;
      const arr = byDate.get(c.date) ?? [];
      arr.push(c);
      byDate.set(c.date, arr);
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [coverage]);

  // Dates (YYYY-MM-DD) the signed-in staffer works, with their time, for the calendar.
  const myShiftByDate = useMemo(() => {
    const m = new Map<string, Shift>();
    for (const s of upcoming) m.set(s.date, s);
    return m;
  }, [upcoming]);

  // Dates anyone works (for the lavender dot on the calendar).
  const coveredDates = useMemo(() => new Set(coverage.map((c) => c.date)), [coverage]);

  const icalUrl =
    member?.ical_token && origin
      ? `${origin}/api/public/shifts-ical?token=${member.ical_token}`
      : "";

  async function copyLink() {
    if (!icalUrl) return;
    try {
      await navigator.clipboard.writeText(icalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable — the input is selectable as a fallback */
    }
  }

  if (!data) return <Skeleton />;
  if (!member) return <NotSetUp />;

  return (
    <div className="mt-6 space-y-8">
      {/* Need coverage? Point to the Open Shifts hub where shift ids resolve. */}
      <Link
        href="/open-shifts"
        className="flex items-center justify-between gap-3 rounded-2xl bg-lavender/30 px-4 py-3 transition-colors hover:bg-lavender/40"
      >
        <span className="text-[14px]">
          Need a shift covered? Open the <span className="font-medium">Open Shifts</span> page to
          request coverage or pick up a teammate&apos;s shift.
        </span>
        <span className="shrink-0 text-ink/40">→</span>
      </Link>

      {/* Upcoming shift cards */}
      <section>
        <h2 className="text-2xl font-medium">Upcoming shifts</h2>
        <div className="mt-3 space-y-2">
          {upcoming.length === 0 ? (
            <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
              You&apos;re not scheduled right now.
            </p>
          ) : (
            upcoming.map((s) => (
              <div key={s.date} className="rounded-2xl bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[15px] font-medium">{fmtWeekday(s.date)}</p>
                  {s.is_training && (
                    <span className="shrink-0 rounded-full bg-butter px-2.5 py-0.5 text-[11px]">
                      Training
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[14px] text-ink/60">
                  {prettyRange(s.start_time, s.end_time)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Calendar */}
      <section>
        <h2 className="text-2xl font-medium">Calendar</h2>
        <p className="mt-0.5 text-[13px] text-ink/55">
          Your shifts are highlighted. A dot means someone else is working that day.
        </p>
        <div className="mt-3 space-y-4">
          <MonthCalendar monthOffset={0} myShiftByDate={myShiftByDate} coveredDates={coveredDates} />
          <MonthCalendar monthOffset={1} myShiftByDate={myShiftByDate} coveredDates={coveredDates} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-ink/55">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-sage" /> You work
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-lavender-deep" /> Someone&apos;s working
          </span>
        </div>
      </section>

      {/* Who's working — next 14 days */}
      <section>
        <h2 className="text-2xl font-medium">Who&apos;s working</h2>
        <p className="mt-0.5 text-[13px] text-ink/55">The next 14 days.</p>
        <div className="mt-3 space-y-2">
          {next14.length === 0 ? (
            <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
              No one&apos;s scheduled in the next two weeks yet.
            </p>
          ) : (
            next14.map(([date, people]) => (
              <div key={date} className="rounded-2xl bg-white/70 p-3">
                <p className="text-[13px] font-medium text-ink/60">{fmtWeekday(date)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {people.map((p, i) => (
                    <span
                      key={`${date}-${i}`}
                      className="flex items-center gap-1.5 rounded-full bg-cream px-3 py-1 text-[13px]"
                    >
                      {p.member_name ?? "Unassigned"}
                      {p.mine && (
                        <span className="rounded-full bg-sage px-2 py-0.5 text-[10px] text-ink">
                          You
                        </span>
                      )}
                      {p.is_training && (
                        <span className="rounded-full bg-butter px-2 py-0.5 text-[10px]">
                          Training
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Add to phone calendar */}
      <section className="rounded-2xl bg-white p-4">
        <h2 className="text-xl font-medium">Add to your phone calendar</h2>
        {icalUrl ? (
          <>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={icalUrl}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputCls} flex-1 text-[13px]`}
              />
              <button
                onClick={copyLink}
                className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
            <p className="mt-2 text-[13px] text-ink/55">
              Paste this into your calendar app&apos;s &quot;Subscribe to calendar&quot; / &quot;Add by
              URL&quot; option and your shifts will appear automatically and stay updated.
            </p>
          </>
        ) : (
          <p className="mt-2 text-[13px] text-ink/55">
            Your calendar link isn&apos;t ready yet — ask the owner to finish your setup.
          </p>
        )}
      </section>
    </div>
  );
}

// A simple, mobile-readable month grid. Days you work are filled sage and show
// your start time; other covered days get a small lavender dot.
function MonthCalendar({
  monthOffset,
  myShiftByDate,
  coveredDates,
}: {
  monthOffset: number;
  myShiftByDate: Map<string, Shift>;
  coveredDates: Set<string>;
}) {
  const base = fromISO(todayISO());
  const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const year = first.getFullYear();
  const month = first.getMonth();
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const leadBlanks = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayISO();

  const cells: (string | null)[] = [];
  for (let i = 0; i < leadBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toISO(new Date(year, month, d)));
  }

  return (
    <div className="rounded-2xl bg-white p-3">
      <p className="mb-2 text-center text-[14px] font-medium">{monthLabel}</p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_NAMES.map((w) => (
          <div key={w} className="pb-1 text-[10px] uppercase tracking-wide text-ink/40">
            {w.charAt(0)}
          </div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`b-${i}`} />;
          const mine = myShiftByDate.get(iso);
          const covered = coveredDates.has(iso);
          const dayNum = Number(iso.slice(8, 10));
          const isToday = iso === today;
          return (
            <div
              key={iso}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-[12px] ${
                mine ? "bg-sage text-ink" : "bg-cream/60"
              } ${isToday ? "ring-1 ring-ink/40" : ""}`}
            >
              <span className={mine ? "font-medium" : "text-ink/70"}>{dayNum}</span>
              {mine ? (
                <span className="text-[9px] leading-none text-ink/70">
                  {mine.start_time.slice(0, 5)}
                </span>
              ) : covered ? (
                <span className="mt-0.5 inline-block h-1 w-1 rounded-full bg-lavender-deep" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Availability ----------------------------------------------------------

function AvailabilityTab() {
  const [data, setData] = useState<AvailData | null>(null);
  const [busyWd, setBusyWd] = useState<number | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/my-availability");
      setData(r.ok ? await r.json() : { member: null, weekly: {}, dates: [] });
    } catch {
      setData({ member: null, weekly: {}, dates: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleWeekday(wd: number, available: boolean) {
    setBusyWd(wd);
    try {
      await fetch("/api/my-availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly: { [wd]: available } }),
      });
      await load();
    } catch {
      await load();
    } finally {
      setBusyWd(null);
    }
  }

  async function addDate() {
    if (!newDate) return;
    setAdding(true);
    try {
      await fetch("/api/my-availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add_date: { date: newDate, note: newNote || null } }),
      });
      setNewDate("");
      setNewNote("");
      await load();
    } catch {
      await load();
    } finally {
      setAdding(false);
    }
  }

  async function removeDate(id: number) {
    setRemoving(id);
    try {
      await fetch("/api/my-availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove_date_id: id }),
      });
      await load();
    } catch {
      await load();
    } finally {
      setRemoving(null);
    }
  }

  if (!data) return <Skeleton />;
  if (!data.member) return <NotSetUp />;

  const weekly = data.weekly ?? {};
  const dates = data.dates ?? [];

  return (
    <div className="mt-6 space-y-8">
      <p className="rounded-2xl bg-lavender/30 px-4 py-3 text-[14px]">
        This helps the owner schedule you. It&apos;s a preference, not time off — use the Time off tab
        to request specific days off.
      </p>

      {/* Weekly availability toggles */}
      <section>
        <h2 className="text-2xl font-medium">Days I can usually work</h2>
        <div className="mt-3 space-y-2">
          {WEEKDAY_NAMES.map((name, wd) => {
            // Default ON unless explicitly set to false.
            const available = weekly[wd] !== false;
            return (
              <div
                key={wd}
                className="flex items-center justify-between rounded-2xl bg-white p-4"
              >
                <span className="text-[15px] font-medium">{name}</span>
                <button
                  onClick={() => toggleWeekday(wd, !available)}
                  disabled={busyWd === wd}
                  aria-pressed={available}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                    available ? "bg-sage-deep" : "bg-ink/15"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${
                      available ? "left-7" : "left-1"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* One-off unavailable dates */}
      <section>
        <h2 className="text-2xl font-medium">Specific days I can&apos;t work</h2>
        <div className="mt-3 space-y-2">
          {dates.length === 0 ? (
            <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
              No specific days added.
            </p>
          ) : (
            dates.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{fmtWeekday(d.the_date)}</p>
                  {d.note && <p className="truncate text-[13px] text-ink/55">{d.note}</p>}
                </div>
                <button
                  onClick={() => removeDate(d.id)}
                  disabled={removing === d.id}
                  aria-label="Remove"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/15 text-ink/60 disabled:opacity-40"
                >
                  {removing === d.id ? "…" : "×"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add form */}
        <div className="mt-3 rounded-2xl bg-white p-4">
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Date</label>
              <input
                type="date"
                value={newDate}
                min={todayISO()}
                onChange={(e) => setNewDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Note (optional)</label>
              <input
                type="text"
                value={newNote}
                placeholder="e.g. doctor's appointment"
                onChange={(e) => setNewNote(e.target.value)}
                className={inputCls}
              />
            </div>
            <button
              onClick={addDate}
              disabled={!newDate || adding}
              className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
            >
              {adding ? "Adding…" : "Add day"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---- Time off --------------------------------------------------------------

function TimeOffTab() {
  const [data, setData] = useState<TimeOffData | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/my-time-off");
      setData(r.ok ? await r.json() : { member: null, requests: [] });
    } catch {
      setData({ member: null, requests: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!start) {
      setError("Pick at least a start date.");
      return;
    }
    const endDate = end || start;
    if (endDate < start) {
      setError("End date can't be before the start date.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/my-time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: start, end_date: endDate, note: note || null }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't submit your request.");
      } else {
        setStart("");
        setEnd("");
        setNote("");
        await load();
      }
    } catch {
      setError("Couldn't submit your request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data) return <Skeleton />;
  if (!data.member) return <NotSetUp />;

  const requests = data.requests ?? [];

  function statusPill(status: string) {
    if (status === "approved")
      return <span className="rounded-full bg-sage px-2.5 py-1 text-[11px] text-ink">Approved</span>;
    if (status === "denied")
      return (
        <span className="rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">Denied</span>
      );
    return <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px]">Pending</span>;
  }

  return (
    <div className="mt-6 space-y-8">
      {/* Request form */}
      <section className="rounded-2xl bg-white p-4">
        <h2 className="text-xl font-medium">Request time off</h2>
        <div className="mt-3 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label className={labelCls}>From</label>
              <input
                type="date"
                value={start}
                min={todayISO()}
                onChange={(e) => {
                  setStart(e.target.value);
                  // Default the end date to the start when it's empty or earlier.
                  if (!end || end < e.target.value) setEnd(e.target.value);
                }}
                className={inputCls}
              />
            </div>
            <div className="flex-1">
              <label className={labelCls}>To</label>
              <input
                type="date"
                value={end}
                min={start || todayISO()}
                onChange={(e) => setEnd(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Note (optional)</label>
            <input
              type="text"
              value={note}
              placeholder="e.g. family trip"
              onChange={(e) => setNote(e.target.value)}
              className={inputCls}
            />
          </div>
          {error && <p className="text-[13px] text-blush-deep">{error}</p>}
          <button
            onClick={submit}
            disabled={!start || submitting}
            className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </section>

      {/* Existing requests */}
      <section>
        <h2 className="text-2xl font-medium">Your requests</h2>
        <div className="mt-3 space-y-2">
          {requests.length === 0 ? (
            <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
              No time-off requests yet.
            </p>
          ) : (
            requests.map((r) => {
              const range =
                r.start_date === r.end_date
                  ? fmtShort(r.start_date)
                  : `${fmtShort(r.start_date)} – ${fmtShort(r.end_date)}`;
              return (
                <div key={r.id} className="rounded-2xl bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[15px] font-medium">{range}</p>
                    {statusPill(r.status)}
                  </div>
                  {r.note && <p className="mt-1 text-[13px] text-ink/60">{r.note}</p>}
                  {r.decided_note && (
                    <p className="mt-1 text-[13px] text-ink/55">
                      <span className="text-ink/40">Owner:</span> {r.decided_note}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
