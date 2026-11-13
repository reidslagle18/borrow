"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtClock, fmtDateTime } from "@/lib/timeclock-shared";

// ---- Types (match the existing API responses) ------------------------------

type ClockMember = { id: number; name: string };

type TodayShift = {
  id: number;
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  is_training: boolean;
};

type OpenEntry = {
  id: number;
  clock_in: string;
  missed_clockout: boolean;
};

type RecentEntry = {
  id: number;
  clock_in: string;
  clock_out: string | null;
  status: string;
  source: string;
  missed_clockout: boolean;
};

type ClockStatus = {
  signed_in: boolean;
  device_registered: boolean;
  device_name: string | null;
  member: ClockMember | null;
  today_shift: TodayShift | null;
  open_entry: OpenEntry | null;
  recent: RecentEntry[];
};

const cardCls = "rounded-2xl bg-white p-4";
const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";
const outlineBtnCls = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";
const primaryBtnCls =
  "rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40";

// "HH:MM" (24h) → "h:MM AM/PM"
function prettyTime(hhmm: string): string {
  const [hStr, mStr] = (hhmm || "").split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
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

function statusPill(status: string) {
  if (status === "approved")
    return <span className="rounded-full bg-sage px-2.5 py-1 text-[11px] text-ink">Approved</span>;
  if (status === "missed" || status === "pending_approval")
    return (
      <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px]">
        {status === "missed" ? "Needs review" : "Pending"}
      </span>
    );
  if (status === "open")
    return <span className="rounded-full bg-lavender px-2.5 py-1 text-[11px]">Open</span>;
  return <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px]">{status}</span>;
}

export default function ClockPage() {
  // Keep AppShell's auth behavior consistent with the rest of the studio.
  useMe();

  const [data, setData] = useState<ClockStatus | null>(null);
  const didInitialLoad = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/clock/status", { cache: "no-store" });
      setData(
        r.ok
          ? await r.json()
          : {
              signed_in: false,
              device_registered: false,
              device_name: null,
              member: null,
              today_shift: null,
              open_entry: null,
              recent: [],
            },
      );
    } catch {
      setData({
        signed_in: false,
        device_registered: false,
        device_name: null,
        member: null,
        today_shift: null,
        open_entry: null,
        recent: [],
      });
    }
  }, []);

  useEffect(() => {
    if (!didInitialLoad.current) {
      didInitialLoad.current = true;
      load();
    }
    const id = setInterval(load, 30_000); // keep the big button in sync with reality
    return () => clearInterval(id);
  }, [load]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Time clock</h1>
        <p className="mt-1.5 text-sm text-ink/50">Clock in and out for your shift.</p>

        {!data ? (
          <Skeleton />
        ) : !data.device_registered ? (
          <SetupDevice onDone={load} />
        ) : !data.member ? (
          <div className={`mt-6 ${cardCls} text-center`}>
            <p className="text-[15px] text-ink/60">
              No team profile is linked to your login yet — ask the owner.
            </p>
          </div>
        ) : (
          <ClockedView data={data} reload={load} />
        )}
      </div>
    </AppShell>
  );
}

// ---- Device setup ----------------------------------------------------------

function SetupDevice({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function register() {
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clock/register-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "That code didn't work. Ask the owner for a fresh one.");
      } else {
        onDone();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`mt-6 ${cardCls}`}>
      <h2 className="text-xl font-medium">Set up this device</h2>
      <p className="mt-2 text-[14px] text-ink/60">
        This iPad isn&apos;t registered yet. The owner generates a one-time code under{" "}
        <span className="font-medium text-ink">Team → Devices</span>. Enter it below to link this
        device to the store.
      </p>
      <div className="mt-4 space-y-3">
        <div>
          <label className={labelCls}>One-time code</label>
          <input
            type="text"
            value={code}
            autoCapitalize="characters"
            placeholder="e.g. 4B9K2"
            onChange={(e) => setCode(e.target.value)}
            className={inputCls}
          />
        </div>
        {error && <p className="text-[13px] text-blush-deep">{error}</p>}
        <button onClick={register} disabled={!code.trim() || busy} className={primaryBtnCls}>
          {busy ? "Registering…" : "Register device"}
        </button>
      </div>
    </div>
  );
}

// ---- Clocked-in / out view -------------------------------------------------

function ClockedView({ data, reload }: { data: ClockStatus; reload: () => void }) {
  const member = data.member!;
  const openEntry = data.open_entry;
  const todayShift = data.today_shift;

  const [punching, setPunching] = useState(false);
  const [punchError, setPunchError] = useState("");
  const [confirmation, setConfirmation] = useState("");

  async function punch(action: "in" | "out") {
    setPunching(true);
    setPunchError("");
    setConfirmation("");
    try {
      const res = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPunchError(d.error || "Couldn't record that. Try again.");
      } else {
        if (action === "in") {
          setConfirmation(
            d.early_arrival
              ? "You're a little early — that's fine, it's logged."
              : "You're clocked in. Have a great shift!",
          );
        } else {
          setConfirmation(
            d.late_clockout
              ? "Clocked out — your extra time is logged for review."
              : "You're clocked out. See you next time!",
          );
        }
        await reload();
      }
    } catch {
      setPunchError("Couldn't reach the server. Try again.");
    } finally {
      setPunching(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="font-serif text-3xl font-medium">Hi, {member.name}</h2>
        {data.device_name && (
          <p className="mt-1 text-[13px] text-ink/50">{data.device_name}</p>
        )}
      </div>

      {/* Today's shift */}
      <div className={cardCls}>
        {todayShift ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] font-medium">
              Today: {prettyTime(todayShift.start_time)} – {prettyTime(todayShift.end_time)}
            </p>
            {todayShift.is_training && (
              <span className="shrink-0 rounded-full bg-butter px-2.5 py-0.5 text-[11px]">
                Training
              </span>
            )}
          </div>
        ) : (
          <p className="text-[15px] text-ink/60">
            No shift scheduled today — you can still clock in.
          </p>
        )}
      </div>

      {/* THE BIG BUTTON */}
      <div className="flex flex-col items-center gap-4 py-2">
        {openEntry ? (
          <>
            <p className="text-[15px] text-ink/60">
              Clocked in at <span className="font-medium text-ink">{fmtClock(openEntry.clock_in)}</span>
            </p>
            <button
              onClick={() => punch("out")}
              disabled={punching}
              className="w-full max-w-md rounded-3xl bg-ink py-10 text-2xl font-medium text-cream transition-opacity disabled:opacity-40 md:text-3xl"
            >
              {punching ? "One sec…" : "Clock Out"}
            </button>
          </>
        ) : (
          <button
            onClick={() => punch("in")}
            disabled={punching}
            className="w-full max-w-md rounded-3xl bg-ink py-10 text-2xl font-medium text-cream transition-opacity disabled:opacity-40 md:text-3xl"
          >
            {punching ? "One sec…" : "Clock In"}
          </button>
        )}
        {confirmation && (
          <p className="rounded-full bg-sage px-4 py-2 text-center text-[14px] text-ink">
            {confirmation}
          </p>
        )}
        {punchError && <p className="text-center text-[14px] text-blush-deep">{punchError}</p>}
      </div>

      {/* Missed clock-out resolution */}
      {openEntry?.missed_clockout && (
        <MissedClockout entryId={openEntry.id} reload={reload} />
      )}

      {/* Shift tools — only while clocked in with a scheduled shift today */}
      {openEntry && todayShift && (
        <>
          <ChecklistSection shiftId={todayShift.id} type="opening" title="Opening checklist" />
          <ChecklistSection shiftId={todayShift.id} type="closing" title="Closing checklist" />
          <ShiftNoteSection shiftId={todayShift.id} />
        </>
      )}

      {/* Manual time request */}
      <ManualRequest />

      {/* Recent entries */}
      <section>
        <h3 className="text-xl font-medium">Recent</h3>
        <div className="mt-3 space-y-2">
          {data.recent.length === 0 ? (
            <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">No punches yet.</p>
          ) : (
            data.recent.map((e) => (
              <div key={e.id} className={`${cardCls} flex items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <p className="truncate text-[14px]">
                    {fmtDateTime(e.clock_in)}{" "}
                    <span className="text-ink/40">→</span>{" "}
                    {e.clock_out ? (
                      fmtClock(e.clock_out)
                    ) : e.missed_clockout ? (
                      <span className="text-blush-deep">missed</span>
                    ) : (
                      <span className="text-ink/55">still in</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12px] uppercase tracking-wide text-ink/40">
                    {e.source}
                  </p>
                </div>
                <div className="shrink-0">{statusPill(e.status)}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

// ---- Missed clock-out ------------------------------------------------------

function MissedClockout({ entryId, reload }: { entryId: number; reload: () => void }) {
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!end) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clock/resolve-missed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId, end }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't submit that. Try again.");
      } else {
        await reload();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-blush-deep p-4 text-cream">
      <h3 className="text-lg font-medium">Missed clock-out</h3>
      <p className="mt-1 text-[14px] text-cream/90">
        Looks like a shift never got closed out. Enter your actual end time and it&apos;ll go to the
        owner for approval.
      </p>
      <div className="mt-3 space-y-3">
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-cream/70">
            Actual end time
          </label>
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full rounded-xl border border-cream/30 bg-white/95 px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-cream"
          />
        </div>
        {error && <p className="text-[13px] text-butter">{error}</p>}
        <button
          onClick={submit}
          disabled={!end || busy}
          className="rounded-full bg-cream px-5 py-2.5 text-[14px] text-ink disabled:opacity-40"
        >
          {busy ? "Submitting…" : "Submit for approval"}
        </button>
      </div>
    </div>
  );
}

// ---- Manual time request ---------------------------------------------------

function ManualRequest() {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    if (!start || !end) {
      setError("Enter both a start and end time.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clock/manual-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end, reason }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't submit that. Try again.");
      } else {
        setDone(true);
        setStart("");
        setEnd("");
        setReason("");
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cardCls}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[15px] font-medium">iPad acting up? Submit a manual time request</span>
        <span className="text-ink/40">{open ? "–" : "+"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          {done ? (
            <p className="rounded-xl bg-sage px-4 py-3 text-[14px] text-ink">
              Sent to the owner for approval.
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label className={labelCls}>Start</label>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setDone(false);
                }}
                className={inputCls}
              />
            </div>
            <div className="flex-1">
              <label className={labelCls}>End</label>
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setDone(false);
                }}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Reason</label>
            <input
              type="text"
              value={reason}
              placeholder="e.g. kiosk was frozen"
              onChange={(e) => {
                setReason(e.target.value);
                setDone(false);
              }}
              className={inputCls}
            />
          </div>
          {error && <p className="text-[13px] text-blush-deep">{error}</p>}
          <p className="text-[13px] text-ink/55">
            This goes to the owner for approval before it counts toward your hours.
          </p>
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy} className={primaryBtnCls}>
              {busy ? "Submitting…" : "Submit request"}
            </button>
            <button onClick={() => setOpen(false)} className={outlineBtnCls}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Opening / closing checklist -------------------------------------------

type ChecklistItem = {
  id: number;
  label: string;
  checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
};
type ChecklistData = { items: ChecklistItem[]; run: { submitted?: boolean } | null };

function ChecklistSection({
  shiftId,
  type,
  title,
}: {
  shiftId: number;
  type: "opening" | "closing";
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ChecklistData | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uncheckedAtSubmit, setUncheckedAtSubmit] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/clock/checklist?shift_id=${shiftId}&type=${type}`,
        { cache: "no-store" },
      );
      if (r.ok) {
        const d: ChecklistData = await r.json();
        setData(d);
        if (d.run?.submitted) setSubmitted(true);
      } else {
        setData({ items: [], run: null });
      }
    } catch {
      setData({ items: [], run: null });
    }
  }, [shiftId, type]);

  useEffect(() => {
    if (open && !data) load();
  }, [open, data, load]);

  async function toggle(item: ChecklistItem) {
    setBusyId(item.id);
    setError("");
    try {
      const res = await fetch("/api/clock/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shift_id: shiftId,
          type,
          item_id: item.id,
          checked: !item.checked,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't update that. Try again.");
      } else {
        await load();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function finish() {
    setSubmitting(true);
    setError("");
    const unchecked = (data?.items ?? []).filter((i) => !i.checked).length;
    try {
      const res = await fetch("/api/clock/checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_id: shiftId, type, action: "submit" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't submit. Try again.");
      } else {
        setUncheckedAtSubmit(unchecked);
        setSubmitted(true);
        await load();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className={cardCls}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[15px] font-medium">{title}</span>
        <span className="text-ink/40">{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-2">
          {!data ? (
            <div className="h-20 animate-pulse rounded-xl bg-ink/5" />
          ) : items.length === 0 ? (
            <p className="text-[14px] text-ink/55">No checklist items set up.</p>
          ) : (
            <>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggle(item)}
                  disabled={busyId === item.id}
                  className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors disabled:opacity-50 ${
                    item.checked ? "bg-sage/40" : "bg-cream/70"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                      item.checked
                        ? "border-sage-deep bg-sage-deep text-cream"
                        : "border-ink/25 bg-white"
                    }`}
                  >
                    {item.checked ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">{item.label}</span>
                    {item.checked && item.checked_by && (
                      <span className="mt-0.5 block text-[12px] text-ink/50">
                        {item.checked_by}
                        {item.checked_at ? ` · ${fmtClock(item.checked_at)}` : ""}
                      </span>
                    )}
                  </span>
                </button>
              ))}

              {error && <p className="text-[13px] text-blush-deep">{error}</p>}

              {submitted ? (
                <div className="space-y-2">
                  <p className="rounded-xl bg-sage px-4 py-2 text-[14px] text-ink">Submitted</p>
                  {type === "closing" && uncheckedAtSubmit > 0 && (
                    <p className="rounded-xl bg-butter px-4 py-2 text-[13px]">
                      Owner was notified of {uncheckedAtSubmit} unchecked item
                      {uncheckedAtSubmit === 1 ? "" : "s"}.
                    </p>
                  )}
                </div>
              ) : (
                <button onClick={finish} disabled={submitting} className={primaryBtnCls}>
                  {submitting ? "Submitting…" : `Finish ${type} checklist`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- End-of-shift note -----------------------------------------------------

type ShiftNote = { id: number; body: string; created_at: string };

function ShiftNoteSection({ shiftId }: { shiftId: number }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState<ShiftNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/clock/shift-note", { cache: "no-store" });
      if (r.ok) {
        const d: { notes: ShiftNote[] } = await r.json();
        setNotes(d.notes ?? []);
      } else {
        setNotes([]);
      }
    } catch {
      setNotes([]);
    }
  }, []);

  useEffect(() => {
    if (open && notes === null) load();
  }, [open, notes, load]);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/clock/shift-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_id: shiftId, body: body.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't save your note. Try again.");
      } else {
        setDone(true);
        setBody("");
        await load();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cardCls}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[15px] font-medium">End-of-shift note</span>
        <span className="text-ink/40">{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-ink/55">
            Anything the owner or next shift should know? Leave a quick note.
          </p>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDone(false);
            }}
            rows={3}
            placeholder="e.g. steamer is low on water, customer coming back tomorrow for a size 6…"
            className={`${inputCls} resize-y`}
          />
          {error && <p className="text-[13px] text-blush-deep">{error}</p>}
          {done && (
            <p className="rounded-xl bg-sage px-4 py-2 text-[14px] text-ink">Note saved — thanks!</p>
          )}
          <button onClick={submit} disabled={busy || !body.trim()} className={primaryBtnCls}>
            {busy ? "Saving…" : "Leave note"}
          </button>

          {notes && notes.length > 0 && (
            <div className="space-y-2 border-t border-ink/10 pt-3">
              <p className="text-xs uppercase tracking-[0.15em] text-ink/50">Your recent notes</p>
              {notes.map((n) => (
                <div key={n.id} className="rounded-xl bg-cream/70 p-3">
                  <p className="whitespace-pre-wrap text-[14px]">{n.body}</p>
                  <p className="mt-1 text-[12px] text-ink/45">{fmtDateTime(n.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
