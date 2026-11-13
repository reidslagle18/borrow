"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtDateTime } from "@/lib/timeclock-shared";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";
const primaryBtn =
  "rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40";
const outlineBtn = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";

type Announcement = {
  id: number;
  title: string;
  body: string;
  created_by: string | null;
  created_at: string;
  read_count: number;
  readers: string[];
};

type Resp = {
  announcements: Announcement[];
  active_members: number;
};

export default function AnnouncementsPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [data, setData] = useState<Resp | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/announcements");
      if (!res.ok) throw new Error(`announcements ${res.status}`);
      setData(await res.json());
      setLoaded(true);
    } catch {
      setLoadError("Couldn't load announcements — refresh to try again.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setPosting(true);
    setPostError("");
    try {
      const res = await fetch("/api/team/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPostError(d.error || "Couldn't post that announcement.");
      } else {
        setTitle("");
        setBody("");
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

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">
          Announcements
        </h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Post updates for the team and see who&apos;s read them.
        </p>

        {/* Post an announcement */}
        <form
          onSubmit={post}
          className="mt-6 rounded-2xl border border-dashed border-ink/20 bg-white/70 p-5"
        >
          <p className="text-[13px] font-medium text-ink/70">
            Post an announcement
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <label className={labelCls}>Title</label>
              <input
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Message</label>
              <textarea
                rows={4}
                className={inputCls}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
          {postError && <p className="mt-2 text-sm text-blush-deep">{postError}</p>}
          <button
            type="submit"
            disabled={posting || !title.trim() || !body.trim()}
            className={`mt-3 ${primaryBtn}`}
          >
            {posting ? "Posting…" : "Post announcement"}
          </button>
        </form>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded || !data ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {data.announcements.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                No announcements yet.
              </p>
            ) : (
              data.announcements.map((a) => (
                <AnnouncementCard
                  key={a.id}
                  a={a}
                  activeMembers={data.active_members}
                  onChange={load}
                />
              ))
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AnnouncementCard({
  a,
  activeMembers,
  onChange,
}: {
  a: Announcement;
  activeMembers: number;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showReaders, setShowReaders] = useState(false);

  async function archive() {
    if (
      !window.confirm("Archive this announcement? It won't show here anymore.")
    )
      return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/team/announcements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't archive that announcement.");
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
          <span className="text-[17px] font-bold">{a.title}</span>
          <p className="mt-0.5 text-[13px] text-ink/50">
            {fmtDateTime(a.created_at)}
            {a.created_by && ` · ${a.created_by}`}
          </p>
        </div>
        <button
          onClick={archive}
          disabled={busy}
          className={`${outlineBtn} text-ink/60`}
        >
          Archive
        </button>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink/70">{a.body}</p>

      {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}

      <div className="mt-3 border-t border-ink/10 pt-3">
        <button
          onClick={() => setShowReaders((v) => !v)}
          className="text-[13px] text-ink/55 hover:text-ink"
        >
          Read by {a.read_count}/{activeMembers}
          {a.readers.length > 0 && ` ${showReaders ? "▾" : "▸"}`}
        </button>
        {showReaders && a.readers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.readers.map((name, i) => (
              <span
                key={i}
                className="rounded-full bg-sage/40 px-2.5 py-0.5 text-[12px] text-ink/70"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
