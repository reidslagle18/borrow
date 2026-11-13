"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtShort } from "@/lib/dates";
import { fmtDateTime } from "@/lib/timeclock-shared";

const outlineBtn = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";

type Note = {
  id: number;
  shift_date: string;
  body: string;
  needs_attention: boolean;
  member_name: string | null;
  created_at: string;
};

export default function NotesPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [rows, setRows] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/notes");
      if (!res.ok) throw new Error(`notes ${res.status}`);
      setRows(await res.json());
      setLoaded(true);
    } catch {
      setLoadError("Couldn't load shift notes — refresh to try again.");
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

  const visible = flaggedOnly ? rows.filter((r) => r.needs_attention) : rows;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-4xl font-medium md:text-5xl">
              Shift notes
            </h1>
            <p className="mt-1.5 text-sm text-ink/50">
              What the team left you from each shift.
            </p>
          </div>
          <button
            onClick={() => setFlaggedOnly((v) => !v)}
            className={`rounded-full px-4 py-2 text-[13px] ${
              flaggedOnly
                ? "bg-blush-deep text-cream"
                : "border border-ink/15 text-ink/70"
            }`}
          >
            {flaggedOnly ? "Showing flagged" : "Show only flagged"}
          </button>
        </div>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {visible.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                {flaggedOnly
                  ? "Nothing flagged right now."
                  : "No shift notes yet."}
              </p>
            ) : (
              visible.map((n) => (
                <NoteCard key={n.id} note={n} onChange={load} />
              ))
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function NoteCard({ note, onChange }: { note: Note; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/team/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't save that change.");
      } else {
        await onChange();
      }
    } catch {
      setErr("Couldn't reach the studio — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (
      !window.confirm(
        "Archive this note? It won't show here anymore but is never deleted."
      )
    )
      return;
    await patch({ archive: true });
  }

  return (
    <div
      className={`rounded-2xl bg-white p-4 ${
        note.needs_attention ? "border border-blush-deep" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-bold">
              {note.member_name || "Team"}
            </span>
            {note.needs_attention && (
              <span className="rounded-full bg-blush-deep px-2.5 py-0.5 text-[11px] text-cream">
                Needs attention
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-ink/50">
            {fmtDateTime(note.created_at)}
            {note.shift_date && ` · shift ${fmtShort(note.shift_date.slice(0, 10))}`}
          </p>
        </div>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink/70">
        {note.body}
      </p>

      {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => patch({ needs_attention: !note.needs_attention })}
          disabled={busy}
          className={outlineBtn}
        >
          {note.needs_attention ? "Unflag" : "Flag"}
        </button>
        <button
          onClick={archive}
          disabled={busy}
          className={`${outlineBtn} text-ink/60`}
        >
          Archive
        </button>
      </div>
    </div>
  );
}
