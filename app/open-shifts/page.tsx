"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtWeekday } from "@/lib/dates";
import { prettyRange } from "@/lib/team-shared";

// ---- Types (match the existing API responses) ------------------------------

type Member = { id: number; name: string };

// Outgoing coverage request the signed-in staffer created.
type MineRequest = {
  id: number;
  shift_date: string;
  start_time: string;
  end_time: string;
  kind: "coverage" | "sick";
  status: "open" | "claimed" | "approved" | "denied";
  claimed_by_name: string | null;
  target_member_name: string | null;
};

// A claimable shift on the open board.
type BoardShift = {
  id: number;
  shift_date: string;
  start_time: string;
  end_time: string;
  kind: "coverage" | "sick" | "extra";
  requester_name: string | null;
};

type CoverageData = { member: Member | null; board: BoardShift[]; mine: MineRequest[] };

// Upcoming shift (the orchestrator adds `id` to /api/my-shifts upcoming[]).
type UpcomingShift = {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  is_training: boolean;
};
type ShiftsData = { member: Member | null; upcoming: UpcomingShift[] };

type Teammate = { id: number; name: string; phone: string | null };

const cardCls = "rounded-2xl bg-white p-4";
const primaryBtnCls =
  "rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40";
const outlineBtnCls = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";
const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";

function Skeleton() {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
      ))}
    </div>
  );
}

function NotSetUp() {
  return (
    <div className="mt-6 rounded-2xl bg-white p-6 text-center">
      <p className="text-[15px] text-ink/60">
        Your schedule profile isn&apos;t set up yet — ask the owner to finish your setup.
      </p>
    </div>
  );
}

export default function OpenShiftsPage() {
  useMe();

  const [cov, setCov] = useState<CoverageData | null>(null);
  const [shifts, setShifts] = useState<ShiftsData | null>(null);
  const [teammates, setTeammates] = useState<Teammate[]>([]);

  const load = useCallback(async () => {
    try {
      const [cr, sr, dr] = await Promise.all([
        fetch("/api/coverage", { cache: "no-store" }),
        fetch("/api/my-shifts", { cache: "no-store" }),
        fetch("/api/directory", { cache: "no-store" }),
      ]);
      setCov(cr.ok ? await cr.json() : { member: null, board: [], mine: [] });
      setShifts(sr.ok ? await sr.json() : { member: null, upcoming: [] });
      setTeammates(dr.ok ? await dr.json() : []);
    } catch {
      setCov({ member: null, board: [], mine: [] });
      setShifts({ member: null, upcoming: [] });
      setTeammates([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loaded = cov !== null && shifts !== null;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Open shifts</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Request coverage for your shifts, or pick up a teammate&apos;s.
        </p>

        {!loaded ? (
          <Skeleton />
        ) : !cov?.member ? (
          <NotSetUp />
        ) : (
          <div className="mt-6 space-y-10">
            <RequestCoverageSection
              member={cov.member}
              upcoming={shifts?.upcoming ?? []}
              mine={cov.mine}
              teammates={teammates}
              reload={load}
            />
            <MyRequestsSection mine={cov.mine} reload={load} />
            <BoardSection board={cov.board} reload={load} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---- Section C: request coverage for one of my upcoming shifts --------------

function RequestCoverageSection({
  member,
  upcoming,
  mine,
  teammates,
  reload,
}: {
  member: Member;
  upcoming: UpcomingShift[];
  mine: MineRequest[];
  teammates: Teammate[];
  reload: () => void;
}) {
  // Hide shifts that already have an outgoing request (match by date).
  const requestedDates = new Set(mine.map((m) => m.shift_date));
  const requestable = upcoming.filter((s) => !requestedDates.has(s.date));

  return (
    <section>
      <h2 className="text-2xl font-medium">Need a shift covered?</h2>
      <p className="mt-0.5 text-[13px] text-ink/55">
        Pick an upcoming shift and choose how to find coverage.
      </p>
      <div className="mt-3 space-y-2">
        {requestable.length === 0 ? (
          <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
            No upcoming shifts to request coverage for.
          </p>
        ) : (
          requestable.map((s) => (
            <RequestCard
              key={s.id}
              shift={s}
              selfName={member.name}
              teammates={teammates}
              reload={reload}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RequestCard({
  shift,
  selfName,
  teammates,
  reload,
}: {
  shift: UpcomingShift;
  selfName: string;
  teammates: Teammate[];
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<null | "teammate">(null);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const others = teammates.filter((t) => t.name !== selfName);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't post that. Try again.");
      } else {
        reload();
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function sick() {
    if (!confirm("Mark this shift as a sick / emergency coverage request? The owner is notified.")) {
      return;
    }
    post({ shift_id: shift.id, kind: "sick" });
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium">{fmtWeekday(shift.date)}</p>
          <p className="mt-0.5 text-[14px] text-ink/60">
            {prettyRange(shift.start_time, shift.end_time)}
          </p>
        </div>
        {shift.is_training && (
          <span className="shrink-0 rounded-full bg-butter px-2.5 py-0.5 text-[11px]">
            Training
          </span>
        )}
      </div>

      {!open ? (
        <button onClick={() => setOpen(true)} className={`${outlineBtnCls} mt-3`}>
          I need coverage
        </button>
      ) : (
        <div className="mt-3 space-y-3 border-t border-ink/10 pt-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => post({ shift_id: shift.id, kind: "coverage" })}
              disabled={busy}
              className={outlineBtnCls}
            >
              Post to Open Shifts
            </button>
            <button
              onClick={() => setMode((m) => (m === "teammate" ? null : "teammate"))}
              disabled={busy}
              className={outlineBtnCls}
            >
              Ask a specific teammate
            </button>
            <button
              onClick={sick}
              disabled={busy}
              className="rounded-full bg-blush-deep px-4 py-2 text-[13px] text-cream disabled:opacity-40"
            >
              Sick / emergency
            </button>
          </div>

          {mode === "teammate" && (
            <div className="space-y-2">
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className={inputCls}
              >
                <option value="">Choose a teammate…</option>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  post({
                    shift_id: shift.id,
                    kind: "coverage",
                    target_member_id: Number(targetId),
                  })
                }
                disabled={busy || !targetId}
                className={primaryBtnCls}
              >
                {busy ? "Sending…" : "Ask teammate"}
              </button>
            </div>
          )}

          {error && <p className="text-[13px] text-blush-deep">{error}</p>}
          <button
            onClick={() => {
              setOpen(false);
              setMode(null);
              setError("");
            }}
            className="text-[13px] text-ink/50 underline"
          >
            Never mind
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Section A: my outgoing requests ---------------------------------------

function MyRequestsSection({ mine, reload }: { mine: MineRequest[]; reload: () => void }) {
  return (
    <section>
      <h2 className="text-2xl font-medium">My coverage requests</h2>
      <div className="mt-3 space-y-2">
        {mine.length === 0 ? (
          <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
            You haven&apos;t requested any coverage.
          </p>
        ) : (
          mine.map((r) => <MineCard key={r.id} req={r} reload={reload} />)
        )}
      </div>
    </section>
  );
}

function statusPill(status: MineRequest["status"]) {
  if (status === "approved")
    return <span className="rounded-full bg-sage px-2.5 py-1 text-[11px] text-ink">Approved</span>;
  if (status === "denied")
    return (
      <span className="rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">Denied</span>
    );
  if (status === "claimed")
    return <span className="rounded-full bg-lavender px-2.5 py-1 text-[11px]">Claimed</span>;
  return <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px]">Open</span>;
}

function MineCard({ req, reload }: { req: MineRequest; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canCancel = req.status === "open" || req.status === "claimed";

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/coverage/${req.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Couldn't cancel. Try again.");
      } else {
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
          <p className="text-[15px] font-medium">{fmtWeekday(req.shift_date)}</p>
          <p className="mt-0.5 text-[14px] text-ink/60">
            {prettyRange(req.start_time, req.end_time)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {req.kind === "sick" && (
            <span className="rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">
              Urgent
            </span>
          )}
          {statusPill(req.status)}
        </div>
      </div>

      {req.target_member_name && req.status === "open" && (
        <p className="mt-1.5 text-[13px] text-ink/55">Asked {req.target_member_name}</p>
      )}
      {req.claimed_by_name && (
        <p className="mt-1.5 text-[13px] text-ink/55">
          <span className="text-ink/40">Taken by</span> {req.claimed_by_name}
        </p>
      )}

      {canCancel && (
        <div className="mt-3">
          <button onClick={cancel} disabled={busy} className={outlineBtnCls}>
            {busy ? "Canceling…" : "Cancel request"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[13px] text-blush-deep">{error}</p>}
    </div>
  );
}

// ---- Section B: the open board ---------------------------------------------

function BoardSection({ board, reload }: { board: BoardShift[]; reload: () => void }) {
  return (
    <section>
      <h2 className="text-2xl font-medium">Open shifts board</h2>
      <p className="mt-0.5 text-[13px] text-ink/55">Shifts up for grabs. Claim one to pick it up.</p>
      <div className="mt-3 space-y-2">
        {board.length === 0 ? (
          <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
            Nothing on the board right now.
          </p>
        ) : (
          board.map((b) => <BoardCard key={b.id} shift={b} reload={reload} />)
        )}
      </div>
    </section>
  );
}

function BoardCard({ shift, reload }: { shift: BoardShift; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function claim() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const res = await fetch(`/api/coverage/${shift.id}/claim`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Couldn't claim that — it may have just been taken.");
      } else {
        setResult(d.approved ? "It's yours — approved!" : "Sent for approval.");
        setTimeout(reload, 1200);
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
          <p className="text-[15px] font-medium">{shift.requester_name ?? "Extra shift"}</p>
          <p className="mt-0.5 text-[14px] text-ink/60">{fmtWeekday(shift.shift_date)}</p>
          <p className="text-[14px] text-ink/60">
            {prettyRange(shift.start_time, shift.end_time)}
          </p>
        </div>
        <div className="shrink-0">
          {shift.kind === "sick" ? (
            <span className="rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">
              Urgent
            </span>
          ) : shift.kind === "extra" ? (
            <span className="rounded-full bg-lavender px-2.5 py-1 text-[11px]">Extra</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        {result ? (
          <p className="rounded-full bg-sage px-4 py-2 text-center text-[14px] text-ink">
            {result}
          </p>
        ) : (
          <button onClick={claim} disabled={busy} className={primaryBtnCls}>
            {busy ? "One sec…" : "I'll take it"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-[13px] text-blush-deep">{error}</p>}
    </div>
  );
}
