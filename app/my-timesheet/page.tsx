"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtClock, fmtDateTime, fmtHoursMinutes, toHours } from "@/lib/timeclock-shared";

// ---- Types (match the existing API responses) ------------------------------

type TsMember = { id: number; name: string };

type Entry = {
  id: number;
  clock_in: string;
  clock_out: string | null;
  day: string; // YYYY-MM-DD
  source: string;
  status: string;
  missed_clockout: boolean;
  early_arrival: boolean;
  late_clockout: boolean;
  employee_flagged: boolean;
  employee_flag_note: string | null;
  note: string | null;
  approved_at: string | null;
  minutes: number;
};

type AuditRow = {
  actor_name: string;
  action: string;
  reason: string | null;
  created_at: string;
};

type PeriodInfo = { start: string; end: string; label: string };

type TimesheetData = {
  member: TsMember | null;
  period: PeriodInfo;
  prev: string;
  next: string;
  entries: Entry[];
  audit: Record<string, AuditRow[]>;
  total_minutes: number;
};

const cardCls = "rounded-2xl bg-white p-4";
const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const outlineBtnCls = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";
const primaryBtnCls =
  "rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40";

function Skeleton() {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
      ))}
    </div>
  );
}

function statusPill(status: string) {
  if (status === "approved")
    return <span className="rounded-full bg-sage px-2.5 py-1 text-[11px] text-ink">Approved</span>;
  if (status === "open")
    return <span className="rounded-full bg-lavender px-2.5 py-1 text-[11px]">Open</span>;
  if (status === "completed")
    return (
      <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px]">Awaiting review</span>
    );
  if (status === "pending_approval")
    return <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px]">Pending</span>;
  return <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px]">{status}</span>;
}

function flagPill(label: string, variant: "lavender" | "blush") {
  const cls =
    variant === "blush"
      ? "bg-blush-deep text-cream"
      : "bg-lavender text-ink";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${cls}`}>{label}</span>;
}

export default function MyTimesheetPage() {
  // Keep AppShell's auth behavior consistent with the rest of the studio.
  useMe();

  const [data, setData] = useState<TimesheetData | null>(null);
  const [pivot, setPivot] = useState<string | null>(null); // the period start we're viewing

  const load = useCallback(async (period: string | null) => {
    setData(null);
    try {
      const url = period ? `/api/my-timesheet?period=${encodeURIComponent(period)}` : "/api/my-timesheet";
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) {
        const d: TimesheetData = await r.json();
        setData(d);
        setPivot(d.period?.start ?? null);
      } else {
        setData({
          member: null,
          period: { start: "", end: "", label: "" },
          prev: "",
          next: "",
          entries: [],
          audit: {},
          total_minutes: 0,
        });
      }
    } catch {
      setData({
        member: null,
        period: { start: "", end: "", label: "" },
        prev: "",
        next: "",
        entries: [],
        audit: {},
        total_minutes: 0,
      });
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  // Entries sorted by day (then clock-in) so they read chronologically.
  const sortedEntries = useMemo(() => {
    if (!data) return [];
    return [...data.entries].sort((a, b) => {
      if (a.day !== b.day) return a.day.localeCompare(b.day);
      return a.clock_in.localeCompare(b.clock_in);
    });
  }, [data]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">My timesheet</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Hours are from your exact clock in/out times. If something looks wrong, flag it and the
          owner will review.
        </p>

        {!data ? (
          <Skeleton />
        ) : !data.member ? (
          <div className={`mt-6 ${cardCls} text-center`}>
            <p className="text-[15px] text-ink/60">
              Your timesheet profile isn&apos;t set up yet — ask the owner.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {/* Period nav + total */}
            <div className={`${cardCls} flex flex-col gap-4`}>
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => load(data.prev)}
                  disabled={!data.prev}
                  aria-label="Previous period"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink/15 text-lg disabled:opacity-40"
                >
                  ←
                </button>
                <p className="text-center text-[15px] font-medium">{data.period.label}</p>
                <button
                  onClick={() => load(data.next)}
                  disabled={!data.next}
                  aria-label="Next period"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink/15 text-lg disabled:opacity-40"
                >
                  →
                </button>
              </div>
              <div className="text-center">
                <p className="text-xs uppercase tracking-[0.15em] text-ink/50">Total this period</p>
                <p className="mt-1 font-serif text-3xl font-medium">
                  {fmtHoursMinutes(data.total_minutes)}
                </p>
                <p className="text-[13px] text-ink/50">({toHours(data.total_minutes)} hrs)</p>
              </div>
            </div>

            {/* Entries */}
            <div className="space-y-2">
              {sortedEntries.length === 0 ? (
                <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                  No hours recorded this period.
                </p>
              ) : (
                sortedEntries.map((e) => (
                  <EntryCard
                    key={e.id}
                    entry={e}
                    audit={data.audit?.[String(e.id)] ?? []}
                    reload={() => load(pivot)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---- One entry -------------------------------------------------------------

function EntryCard({
  entry,
  audit,
  reload,
}: {
  entry: Entry;
  audit: AuditRow[];
  reload: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitFlag() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/my-timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entry.id, note: flagNote }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't flag that. Try again.");
      } else {
        setFlagging(false);
        setFlagNote("");
        reload();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cardCls}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium">
            {fmtDateTime(entry.clock_in)} <span className="text-ink/40">→</span>{" "}
            {entry.clock_out ? (
              fmtClock(entry.clock_out)
            ) : entry.missed_clockout ? (
              <span className="text-blush-deep">missed clock-out</span>
            ) : (
              <span className="text-blush-deep">— still clocked in</span>
            )}
          </p>
          <p className="mt-0.5 text-[13px] text-ink/55">{fmtHoursMinutes(entry.minutes)}</p>
        </div>
        <div className="shrink-0">{statusPill(entry.status)}</div>
      </div>

      {/* Flags */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entry.missed_clockout && flagPill("Missed clock-out", "blush")}
        {entry.early_arrival && flagPill("Early", "lavender")}
        {entry.late_clockout && flagPill("Late out", "lavender")}
        {entry.source === "manual" && flagPill("Manual", "lavender")}
      </div>

      {entry.employee_flagged && (
        <p className="mt-2 rounded-xl bg-blush/50 px-3 py-2 text-[13px]">
          <span className="font-medium">Flagged:</span> {entry.employee_flag_note}
        </p>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!entry.employee_flagged && !flagging && (
          <button onClick={() => setFlagging(true)} className={outlineBtnCls}>
            Flag as incorrect
          </button>
        )}
        {audit.length > 0 && (
          <button onClick={() => setShowHistory((s) => !s)} className={outlineBtnCls}>
            {showHistory ? "Hide history" : "History"}
          </button>
        )}
      </div>

      {/* Flag form */}
      {flagging && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={flagNote}
            placeholder="What looks wrong?"
            onChange={(e) => setFlagNote(e.target.value)}
            className={inputCls}
          />
          {error && <p className="text-[13px] text-blush-deep">{error}</p>}
          <div className="flex gap-2">
            <button onClick={submitFlag} disabled={busy} className={primaryBtnCls}>
              {busy ? "Sending…" : "Submit flag"}
            </button>
            <button
              onClick={() => {
                setFlagging(false);
                setError("");
              }}
              className={outlineBtnCls}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && audit.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-ink/10 pt-3">
          {audit.map((a, i) => (
            <p key={i} className="text-[13px] text-ink/60">
              <span className="text-ink/40">{fmtDateTime(a.created_at)}</span> — {a.actor_name}{" "}
              {a.action}
              {a.reason ? `: ${a.reason}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
