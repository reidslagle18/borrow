"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtShort } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";

type TimeOff = {
  id: number;
  team_member_id: number;
  member_name: string;
  start_date: string;
  end_date: string;
  note: string | null;
  status: "pending" | "approved" | "denied";
  decided_note: string | null;
  decided_at: string | null;
  created_at: string;
  assigned_shift_conflicts: number;
};

function rangeLabel(start: string, end: string): string {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  return s === e ? fmtShort(s) : `${fmtShort(s)} – ${fmtShort(e)}`;
}

export default function TimeOffPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [rows, setRows] = useState<TimeOff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/time-off");
      if (!res.ok) throw new Error(`time-off ${res.status}`);
      setRows(await res.json());
      setLoaded(true);
    } catch {
      setLoadError("Couldn't load time-off requests — refresh to try again.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (meLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }
  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
          <p className="text-center text-ink/50">Admins only.</p>
        </div>
      </AppShell>
    );
  }

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Time off</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Approve or deny requests. Approving one you&apos;ve already assigned shifts
          for means you&apos;ll need to find coverage.
        </p>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-4">
              {pending.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                  No pending requests. You&apos;re all caught up.
                </p>
              ) : (
                pending.map((r) => (
                  <PendingCard key={r.id} row={r} onChange={load} />
                ))
              )}
            </div>

            {decided.length > 0 && (
              <div className="mt-10">
                <h2 className="font-serif text-xl italic text-ink/70">Decided</h2>
                <div className="mt-3 space-y-3">
                  {decided.map((r) => (
                    <div key={r.id} className="rounded-2xl bg-white/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-medium">{r.member_name}</span>
                          <span className="ml-2 text-[13px] text-ink/55">
                            {rangeLabel(r.start_date, r.end_date)}
                          </span>
                        </div>
                        {r.status === "approved" ? (
                          <span className="rounded-full bg-sage/50 px-3 py-1 text-[12px] text-ink/70">
                            Approved
                          </span>
                        ) : (
                          <span className="rounded-full bg-blush-deep px-3 py-1 text-[12px] text-cream">
                            Denied
                          </span>
                        )}
                      </div>
                      {r.note && (
                        <p className="mt-1.5 text-[13px] text-ink/55">
                          <span className="text-ink/40">Their note: </span>
                          {r.note}
                        </p>
                      )}
                      {r.decided_note && (
                        <p className="mt-1 text-[13px] text-ink/55">
                          <span className="text-ink/40">Your note: </span>
                          {r.decided_note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function PendingCard({ row, onChange }: { row: TimeOff; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  async function decide(status: "approved" | "denied") {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/team/time-off/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note.trim() || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't save that decision.");
      } else {
        await onChange();
      }
    } catch {
      setErr("Couldn't reach the studio — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[17px] font-bold">{row.member_name}</span>
          <p className="mt-0.5 text-[14px] text-ink/60">
            {rangeLabel(row.start_date, row.end_date)}
          </p>
        </div>
        <span className="rounded-full bg-butter px-3 py-1 text-[12px] text-ink/70">
          Pending
        </span>
      </div>

      {row.note && (
        <p className="mt-2 text-[13px] text-ink/60">
          <span className="text-ink/40">Note: </span>
          {row.note}
        </p>
      )}

      {row.assigned_shift_conflicts > 0 && (
        <p className="mt-3 inline-block rounded-full bg-blush-deep px-3 py-1 text-[12px] text-cream">
          ⚠ {row.assigned_shift_conflicts} assigned shift
          {row.assigned_shift_conflicts === 1 ? "" : "s"} in this range — you&apos;ll
          need coverage
        </p>
      )}

      {noteOpen && (
        <textarea
          rows={2}
          placeholder="Add a note (optional) — shared with them"
          className={`${inputCls} mt-3`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}

      {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => decide("approved")}
          disabled={busy}
          className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
        >
          {busy ? "Saving…" : "Approve"}
        </button>
        <button
          onClick={() => decide("denied")}
          disabled={busy}
          className="rounded-full border border-ink/15 px-4 py-2 text-[13px] disabled:opacity-40"
        >
          Deny
        </button>
        <button
          onClick={() => setNoteOpen((v) => !v)}
          className="rounded-full px-3 py-2 text-[13px] text-ink/50 hover:text-ink"
        >
          {noteOpen ? "Hide note" : "Add note"}
        </button>
      </div>
    </div>
  );
}
