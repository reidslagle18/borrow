"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtDateTime } from "@/lib/timeclock-shared";

// ---- Types (match the existing API responses) ------------------------------

type Member = { id: number; name: string };

type Announcement = {
  id: number;
  title: string;
  body: string;
  created_by: string | null;
  created_at: string;
  read: boolean;
};

type AnnouncementsData = { member: Member | null; announcements: Announcement[] };

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
        Your team profile isn&apos;t set up yet — ask the owner to finish your setup.
      </p>
    </div>
  );
}

export default function AnnouncementsPage() {
  useMe();

  const [data, setData] = useState<AnnouncementsData | null>(null);
  const didMark = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/announcements", { cache: "no-store" });
      setData(r.ok ? await r.json() : { member: null, announcements: [] });
    } catch {
      setData({ member: null, announcements: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Once loaded, mark any unread ones read (one call each), then refresh state.
  useEffect(() => {
    if (!data?.member || didMark.current) return;
    const unread = data.announcements.filter((a) => !a.read);
    if (unread.length === 0) return;
    didMark.current = true;
    (async () => {
      await Promise.all(
        unread.map((a) =>
          fetch("/api/announcements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: a.id }),
          }).catch(() => {}),
        ),
      );
      await load();
    })();
  }, [data, load]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Announcements</h1>
        <p className="mt-1.5 text-sm text-ink/50">News and updates from the owner.</p>

        {!data ? (
          <Skeleton />
        ) : !data.member ? (
          <NotSetUp />
        ) : data.announcements.length === 0 ? (
          <p className="mt-6 rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
            No announcements yet.
          </p>
        ) : (
          <div className="mt-6 space-y-3">
            {data.announcements.map((a) => (
              <div
                key={a.id}
                className={`rounded-2xl p-4 ${a.read ? "bg-white" : "bg-lavender/30"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[17px] font-medium">{a.title}</h2>
                  {!a.read && (
                    <span className="shrink-0 rounded-full bg-lavender px-2.5 py-1 text-[11px]">
                      New
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-[15px] text-ink/80">{a.body}</p>
                <p className="mt-3 text-[12px] text-ink/45">
                  {a.created_by ? `${a.created_by} · ` : ""}
                  {fmtDateTime(a.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
