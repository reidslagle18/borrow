"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtWeekday, todayISO } from "@/lib/dates";
import { prettyRange } from "@/lib/team-shared";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";
const primaryBtn =
  "rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40";
const outlineBtn = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";

type Coverage = {
  id: number;
  kind: "sick" | "extra" | string;
  status: "open" | "claimed" | "approved" | "denied" | "cancelled" | string;
  note: string | null;
  requester_name: string | null;
  target_name: string | null;
  claimed_by_name: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  is_training: boolean;
  created_at: string;
};

function KindPill({ kind }: { kind: string }) {
  if (kind === "sick")
    return (
      <span className="rounded-full bg-blush-deep px-2.5 py-0.5 text-[11px] text-cream">
        Urgent
      </span>
    );
  if (kind === "extra")
    return (
      <span className="rounded-full bg-lavender/60 px-2.5 py-0.5 text-[11px] text-ink/70">
        Extra
      </span>
    );
  return (
    <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px] text-ink/70">
      {kind}
    </span>
  );
}

function shiftLabel(r: Coverage): string {
  return `${fmtWeekday(r.shift_date.slice(0, 10))} · ${prettyRange(
    r.start_time,
    r.end_time
  )}`;
}

export default function CoveragePage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [rows, setRows] = useState<Coverage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  // post-a-shift form
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [postedMsg, setPostedMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/coverage");
      if (!res.ok) throw new Error(`coverage ${res.status}`);
      setRows(await res.json());
      setLoaded(true);
    } catch {
      setLoadError("Couldn't load coverage — refresh to try again.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function postShift(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    setPosting(true);
    setPostError("");
    setPostedMsg("");
    try {
      const res = await fetch("/api/team/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, note: note.trim() || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPostError(d.error || "Couldn't post that shift.");
      } else {
        const n = typeof d.notified === "number" ? d.notified : null;
        setPostedMsg(
          n === null
            ? "Posted to the board."
            : `Posted — ${n} ${n === 1 ? "person" : "people"} notified.`
        );
        setNote("");
        await load();
      }
    } catch {
      setPostError("Couldn't reach the studio — try again.");
    } finally {
      setPosting(false);
    }
  }

  if (meLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
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
        <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
          <p className="text-center text-ink/50">Admins only.</p>
        </div>
      </AppShell>
    );
  }

  const awaiting = rows.filter((r) => r.status === "claimed");
  const open = rows.filter((r) => r.status === "open");
  const recent = rows.filter((r) =>
    ["approved", "denied", "cancelled"].includes(r.status)
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Coverage</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Post open or extra shifts, and approve who picks them up.
        </p>

        {/* Post an extra / open shift */}
        <form
          onSubmit={postShift}
          className="mt-6 rounded-2xl border border-dashed border-ink/20 bg-white/70 p-5"
        >
          <p className="text-[13px] font-medium text-ink/70">
            Post an extra / open shift
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Date</label>
              <input
                type="date"
                className={inputCls}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Note (optional)</label>
              <input
                className={inputCls}
                placeholder="Anything the team should know"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          {postError && <p className="mt-2 text-sm text-blush-deep">{postError}</p>}
          {postedMsg && <p className="mt-2 text-sm text-sage-deep">{postedMsg}</p>}
          <button
            type="submit"
            disabled={posting || !date}
            className={`mt-3 ${primaryBtn}`}
          >
            {posting ? "Posting…" : "Post shift"}
          </button>
        </form>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            {/* Awaiting approval */}
            <div className="mt-8">
              <h2 className="font-serif text-xl italic text-ink/70">
                Awaiting approval
              </h2>
              <div className="mt-3 space-y-3">
                {awaiting.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    No one waiting on a decision.
                  </p>
                ) : (
                  awaiting.map((r) => (
                    <ClaimedCard key={r.id} row={r} onChange={load} />
                  ))
                )}
              </div>
            </div>

            {/* Open — no one yet */}
            <div className="mt-10">
              <h2 className="font-serif text-xl italic text-ink/70">
                Open — no one yet
              </h2>
              <div className="mt-3 space-y-3">
                {open.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    Nothing open on the board.
                  </p>
                ) : (
                  open.map((r) => (
                    <div key={r.id} className="rounded-2xl bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[16px] font-bold">
                          {r.requester_name || "Extra shift"}
                        </span>
                        <KindPill kind={r.kind} />
                      </div>
                      <p className="mt-1 text-[14px] text-ink/60">{shiftLabel(r)}</p>
                      {r.is_training && (
                        <span className="mt-2 inline-block rounded-full bg-butter px-2.5 py-0.5 text-[11px] text-ink/70">
                          Training
                        </span>
                      )}
                      {r.note && (
                        <p className="mt-2 text-[13px] text-ink/55">
                          <span className="text-ink/40">Note: </span>
                          {r.note}
                        </p>
                      )}
                      <p className="mt-2 text-[12px] text-ink/40">
                        On the board — waiting for someone to claim it.
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent */}
            {recent.length > 0 && <RecentSection rows={recent} />}
          </>
        )}
      </div>
    </AppShell>
  );
}

function ClaimedCard({ row, onChange }: { row: Coverage; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function decide(action: "approve" | "deny") {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/team/coverage/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold">
              {row.requester_name || "Extra shift"}
            </span>
            <KindPill kind={row.kind} />
            {row.is_training && (
              <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px] text-ink/70">
                Training
              </span>
            )}
          </div>
          <p className="mt-1 text-[14px] text-ink/60">{shiftLabel(row)}</p>
          <p className="mt-1.5 text-[13px] text-ink/60">
            <span className="text-ink/40">Claimed by: </span>
            {row.claimed_by_name || "—"}
          </p>
          {row.note && (
            <p className="mt-1 text-[13px] text-ink/55">
              <span className="text-ink/40">Note: </span>
              {row.note}
            </p>
          )}
        </div>
      </div>

      {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => decide("approve")}
          disabled={busy}
          className={primaryBtn}
        >
          {busy ? "Saving…" : "Approve"}
        </button>
        <button
          onClick={() => decide("deny")}
          disabled={busy}
          className={outlineBtn}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function RecentSection({ rows }: { rows: Coverage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-serif text-xl italic text-ink/70 hover:text-ink"
      >
        Recent {open ? "▾" : "▸"} ({rows.length})
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/70 p-4"
            >
              <div>
                <span className="font-medium">
                  {r.requester_name || "Extra shift"}
                </span>
                <span className="ml-2 text-[13px] text-ink/55">
                  {shiftLabel(r)}
                </span>
              </div>
              {r.status === "approved" ? (
                <span className="rounded-full bg-sage/50 px-3 py-1 text-[12px] text-ink/70">
                  Approved{r.claimed_by_name ? ` · ${r.claimed_by_name}` : ""}
                </span>
              ) : r.status === "denied" ? (
                <span className="rounded-full bg-blush-deep px-3 py-1 text-[12px] text-cream">
                  Denied
                </span>
              ) : (
                <span className="rounded-full bg-ink/10 px-3 py-1 text-[12px] text-ink/60">
                  Cancelled
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
