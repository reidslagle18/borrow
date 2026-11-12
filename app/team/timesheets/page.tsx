"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtClock, fmtDateTime, fmtHoursMinutes } from "@/lib/timeclock-shared";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";
const primaryBtn =
  "rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40";
const outlineBtn = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";

/** Prefill a datetime-local input from an ISO timestamp, in Central time. */
function toCentralInput(iso: string | null) {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

type Entry = {
  id: number;
  team_member_id: number;
  member_name: string;
  clock_in: string;
  clock_out: string | null;
  day: string;
  source: string;
  status: string;
  missed_clockout: boolean;
  early_arrival: boolean;
  late_clockout: boolean;
  employee_flagged: boolean;
  employee_flag_note: string | null;
  note: string | null;
  approved_by: number | null;
  approved_at: string | null;
  minutes: number;
};

type AuditRow = {
  actor_name: string;
  actor_role: string;
  action: string;
  reason: string | null;
  before: { clock_in?: string | null; clock_out?: string | null } | null;
  after: { clock_in?: string | null; clock_out?: string | null } | null;
  created_at: string;
};

type Resp = {
  period: { start: string; end: string; label: string; closed: boolean };
  prev: string;
  next: string;
  members: { id: number; name: string }[];
  entries: Entry[];
  audit: Record<string, AuditRow[]>;
};

export default function TimesheetsPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [data, setData] = useState<Resp | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [period, setPeriod] = useState<string>("");
  const [member, setMember] = useState<string>("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");

  const load = useCallback(
    async (pivot: string, mem: string) => {
      try {
        const params = new URLSearchParams();
        params.set("period", pivot || "");
        if (mem) params.set("member", mem);
        const res = await fetch(`/api/team/timesheets?${params.toString()}`);
        if (!res.ok) throw new Error(`timesheets ${res.status}`);
        const d: Resp = await res.json();
        setData(d);
        setPeriod(d.period.start);
        setLoaded(true);
      } catch {
        setLoadError("Couldn't load timesheets — refresh to try again.");
      }
    },
    []
  );

  useEffect(() => {
    if (isAdmin) load("", "");
  }, [isAdmin, load]);

  function reload() {
    load(period, member);
  }

  async function closePeriod(close: boolean) {
    if (!data) return;
    let reason: string | null = null;
    if (!close) {
      reason = window.prompt("Reason for reopening this period?");
      if (reason === null) return;
    }
    setClosing(true);
    setCloseError("");
    try {
      const res = await fetch("/api/team/timesheets/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_start: data.period.start,
          close,
          ...(reason ? { reason } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCloseError(d.error || "Couldn't update the period.");
      } else {
        reload();
      }
    } catch {
      setCloseError("Couldn't reach the studio — try again.");
    } finally {
      setClosing(false);
    }
  }

  if (meLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }
  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
          <p className="text-center text-ink/50">Admins only.</p>
        </div>
      </AppShell>
    );
  }

  const needsAttention =
    data?.entries.filter(
      (e) => e.status !== "approved" || e.missed_clockout || e.employee_flagged
    ) ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Timesheets</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Review, approve, and correct staff hours. Changes are kept in the history.
        </p>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded || !data ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            {/* Period + member controls */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => load(data.prev, member)}
                  className={outlineBtn}
                  aria-label="Previous period"
                >
                  ←
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-medium">{data.period.label}</span>
                  {data.period.closed && (
                    <span className="rounded-full bg-sage/50 px-3 py-1 text-[12px] text-ink/70">
                      Closed
                    </span>
                  )}
                </div>
                <button
                  onClick={() => load(data.next, member)}
                  className={outlineBtn}
                  aria-label="Next period"
                >
                  →
                </button>
              </div>
              <select
                className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-ink/40"
                value={member}
                onChange={(e) => {
                  setMember(e.target.value);
                  load(period, e.target.value);
                }}
              >
                <option value="">All team members</option>
                {data.members.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Pay-period close controls */}
            <div className="mt-4 rounded-2xl bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-ink/55">
                  Closing locks the period; changes afterward need a reason and stay
                  in the history.
                </p>
                {data.period.closed ? (
                  <button
                    onClick={() => closePeriod(false)}
                    disabled={closing}
                    className={outlineBtn}
                  >
                    Reopen
                  </button>
                ) : (
                  <button
                    onClick={() => closePeriod(true)}
                    disabled={closing}
                    className={primaryBtn}
                  >
                    Close period
                  </button>
                )}
              </div>
              {closeError && (
                <p className="mt-2 text-sm text-blush-deep">{closeError}</p>
              )}
            </div>

            {/* Needs attention */}
            <div className="mt-8">
              <h2 className="font-serif text-xl italic text-ink/70">
                Needs attention
              </h2>
              <div className="mt-3 space-y-3">
                {needsAttention.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    Nothing to act on in this period.
                  </p>
                ) : (
                  needsAttention.map((e) => (
                    <EntryCard
                      key={e.id}
                      entry={e}
                      audit={data.audit[String(e.id)] ?? []}
                      periodClosed={data.period.closed}
                      onChange={reload}
                    />
                  ))
                )}
              </div>
            </div>

            {/* All entries */}
            <div className="mt-10">
              <h2 className="font-serif text-xl italic text-ink/70">All entries</h2>
              <div className="mt-3 space-y-3">
                {data.entries.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    No entries in this period.
                  </p>
                ) : (
                  data.entries.map((e) => (
                    <EntryCard
                      key={e.id}
                      entry={e}
                      audit={data.audit[String(e.id)] ?? []}
                      periodClosed={data.period.closed}
                      onChange={reload}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "approved")
    return (
      <span className="rounded-full bg-sage/50 px-3 py-1 text-[12px] text-ink/70">
        Approved
      </span>
    );
  return (
    <span className="rounded-full bg-butter px-3 py-1 text-[12px] text-ink/70">
      {status === "pending" ? "Pending" : status}
    </span>
  );
}

function EntryCard({
  entry,
  audit,
  periodClosed,
  onChange,
}: {
  entry: Entry;
  audit: AuditRow[];
  periodClosed: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editIn, setEditIn] = useState(toCentralInput(entry.clock_in));
  const [editOut, setEditOut] = useState(toCentralInput(entry.clock_out));
  const [reason, setReason] = useState("");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/team/timesheets/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't save that change.");
        return false;
      }
      onChange();
      return true;
    } catch {
      setErr("Couldn't reach the studio — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    await patch({ action: "approve" });
  }

  async function saveEdit() {
    const ok = await patch({
      action: "edit",
      clock_in: editIn,
      clock_out: editOut,
      reason,
    });
    if (ok) setEditing(false);
  }

  async function archive() {
    const r = window.prompt("Reason for archiving this entry?");
    if (r === null) return;
    await patch({ action: "archive", reason: r });
  }

  async function clearFlag() {
    await patch({ action: "clear_flag" });
  }

  const outLabel = entry.missed_clockout
    ? "missed clock-out"
    : entry.clock_out
    ? fmtClock(entry.clock_out)
    : "still in";

  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-bold">{entry.member_name}</span>
            <StatusPill status={entry.status} />
          </div>
          <p className="mt-1 text-[14px] text-ink/60">
            {fmtDateTime(entry.clock_in)} → {outLabel} ·{" "}
            {fmtHoursMinutes(entry.minutes)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.missed_clockout && (
              <span className="rounded-full bg-blush-deep px-2.5 py-0.5 text-[11px] text-cream">
                Missed clock-out
              </span>
            )}
            {entry.early_arrival && (
              <span className="rounded-full bg-lavender/60 px-2.5 py-0.5 text-[11px] text-ink/70">
                Early
              </span>
            )}
            {entry.late_clockout && (
              <span className="rounded-full bg-lavender/60 px-2.5 py-0.5 text-[11px] text-ink/70">
                Late out
              </span>
            )}
            {entry.source === "manual" && (
              <span className="rounded-full bg-lavender/60 px-2.5 py-0.5 text-[11px] text-ink/70">
                Manual
              </span>
            )}
            {entry.employee_flagged && (
              <span className="rounded-full bg-blush px-2.5 py-0.5 text-[11px] text-ink/70">
                Flagged: {entry.employee_flag_note || "see note"}
              </span>
            )}
          </div>
          {entry.note && (
            <p className="mt-2 text-[13px] text-ink/55">
              <span className="text-ink/40">Note: </span>
              {entry.note}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {entry.status !== "approved" && (
            <button onClick={approve} disabled={busy} className={primaryBtn}>
              Approve
            </button>
          )}
          <button onClick={() => setEditing((v) => !v)} className={outlineBtn}>
            {editing ? "Cancel" : "Edit"}
          </button>
          <button onClick={archive} disabled={busy} className={outlineBtn}>
            Archive
          </button>
          {entry.employee_flagged && (
            <button onClick={clearFlag} disabled={busy} className={outlineBtn}>
              Clear flag
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 rounded-xl border border-ink/10 bg-cream/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Clock in</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={editIn}
                onChange={(e) => setEditIn(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Clock out</label>
              <input
                type="datetime-local"
                className={inputCls}
                value={editOut}
                onChange={(e) => setEditOut(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Reason (required)</label>
              <input
                className={inputCls}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why you're correcting this entry"
              />
            </div>
          </div>
          {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}
          <button
            onClick={saveEdit}
            disabled={busy}
            className={`mt-3 ${primaryBtn}`}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {err && !editing && <p className="mt-2 text-sm text-blush-deep">{err}</p>}

      <div className="mt-3">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="text-[13px] text-ink/50 hover:text-ink"
        >
          {showHistory ? "Hide history" : "History"}
          {audit.length > 0 ? ` (${audit.length})` : ""}
        </button>
        {showHistory && (
          <div className="mt-2 space-y-2 rounded-xl bg-cream/50 p-3">
            {audit.length === 0 ? (
              <p className="text-[13px] text-ink/45">No history yet.</p>
            ) : (
              audit.map((a, i) => (
                <div key={i} className="text-[13px] text-ink/60">
                  <p>
                    {fmtDateTime(a.created_at)} — {a.actor_name} ({a.actor_role}){" "}
                    {a.action}
                    {a.reason ? `: ${a.reason}` : ""}
                  </p>
                  {(a.before || a.after) && (
                    <div className="mt-0.5 pl-3 text-[12px] text-ink/45">
                      {a.before?.clock_in !== undefined ||
                      a.after?.clock_in !== undefined ? (
                        <p>
                          clock in: {fmtDateTime(a.before?.clock_in ?? null)} →{" "}
                          {fmtDateTime(a.after?.clock_in ?? null)}
                        </p>
                      ) : null}
                      {a.before?.clock_out !== undefined ||
                      a.after?.clock_out !== undefined ? (
                        <p>
                          clock out: {fmtDateTime(a.before?.clock_out ?? null)} →{" "}
                          {fmtDateTime(a.after?.clock_out ?? null)}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {periodClosed && (
        <p className="mt-2 text-[12px] text-ink/40">
          This period is closed — edits still need a reason and are logged.
        </p>
      )}
    </div>
  );
}
