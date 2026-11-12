"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Note = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Role-aware in-app bell for the Team / scheduling feature. Admins see
 * studio-addressed notifications (e.g. new time-off requests); staff see their
 * own (schedule posted/changed, shift reminders, time-off decisions). Polls
 * /api/team/notifications; silently renders nothing until there's something or
 * the feed is reachable.
 */
export default function TeamBell({ variant }: { variant: "sidebar" | "topbar" }) {
  const router = useRouter();
  const [items, setItems] = useState<Note[]>([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/team/notifications");
      if (r.ok) {
        const d = await r.json();
        setItems(d.items || []);
        setCount(d.count || 0);
        setReady(true);
      }
    } catch {
      /* keep previous */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAll() {
    await fetch("/api/team/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    load();
  }

  async function openItem(n: Note) {
    if (!n.read_at) {
      await fetch("/api/team/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      });
    }
    setOpen(false);
    if (n.link) router.push(n.link);
    else load();
  }

  // Nothing to show and no unread — stay out of the way until the feed has data.
  if (ready && items.length === 0) return null;

  const btnBase =
    variant === "sidebar"
      ? "mt-2 flex w-full items-center justify-between rounded-full border border-ink/15 px-4 py-2 text-left text-[13px] text-ink/70 hover:border-ink/35"
      : "relative flex h-9 items-center rounded-full border border-ink/15 bg-white px-3 text-[12px] text-ink/70";

  return (
    <div ref={boxRef} className={variant === "sidebar" ? "relative" : "relative"}>
      <button onClick={() => setOpen((o) => !o)} className={btnBase} aria-label="Team alerts">
        <span>🔔 {variant === "sidebar" ? "Team alerts" : ""}</span>
        {count > 0 && (
          <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-blush-deep px-1.5 py-0.5 text-[11px] font-medium text-cream">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-40 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-ink/10 bg-white p-2 shadow-lg ${
            variant === "topbar" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[11px] uppercase tracking-[0.15em] text-ink/45">Team alerts</span>
            {count > 0 && (
              <button onClick={markAll} className="text-[12px] text-ink/50 hover:text-ink">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-ink/45">You&apos;re all caught up.</p>
          ) : (
            <div className="space-y-1">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`block w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-ink/5 ${
                    n.read_at ? "opacity-60" : "bg-lavender/20"
                  }`}
                >
                  <p className="text-[13px] font-medium">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-[12px] text-ink/60">{n.body}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
