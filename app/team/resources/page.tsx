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

type Resource = {
  id: number;
  kind: "doc" | "policy" | string;
  title: string;
  body: string | null;
  url: string | null;
  position: number;
};

type TrainingStep = { key: string; label: string };
type TrainingMember = { id: number; name: string };
type TrainingProgress = Record<
  string,
  Record<string, { done: boolean; done_at: string | null }>
>;
type Training = {
  steps: TrainingStep[];
  members: TrainingMember[];
  progress: TrainingProgress;
};

export default function ResourcesPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [resources, setResources] = useState<Resource[]>([]);
  const [training, setTraining] = useState<Training | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const [rRes, tRes] = await Promise.all([
        fetch("/api/resources"),
        fetch("/api/team/training"),
      ]);
      if (!rRes.ok) throw new Error(`resources ${rRes.status}`);
      if (!tRes.ok) throw new Error(`training ${tRes.status}`);
      setResources(await rRes.json());
      setTraining(await tRes.json());
      setLoaded(true);
    } catch {
      setLoadError("Couldn't load resources — refresh to try again.");
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

  const docs = resources.filter((r) => r.kind === "doc");
  const policies = resources.filter((r) => r.kind === "policy");

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Resources</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Docs, store policies, and new-hire training.
        </p>

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
            <AddResourceForm onChange={load} />

            <div className="mt-8">
              <h2 className="font-serif text-xl italic text-ink/70">
                Training &amp; docs
              </h2>
              <div className="mt-3 space-y-3">
                {docs.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    No docs yet.
                  </p>
                ) : (
                  docs.map((r) => (
                    <ResourceCard key={r.id} resource={r} onChange={load} />
                  ))
                )}
              </div>
            </div>

            <div className="mt-10">
              <h2 className="font-serif text-xl italic text-ink/70">
                Store policies
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                e.g. what staff can&apos;t waive.
              </p>
              <div className="mt-3 space-y-3">
                {policies.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    No policies yet.
                  </p>
                ) : (
                  policies.map((r) => (
                    <ResourceCard key={r.id} resource={r} onChange={load} />
                  ))
                )}
              </div>
            </div>

            {/* Training checklist */}
            {training && (
              <div className="mt-12">
                <h2 className="font-serif text-xl italic text-ink/70">
                  New-hire training
                </h2>
                <TrainingGrid training={training} onChange={load} />
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function AddResourceForm({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"doc" | "policy">("doc");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          body: body.trim() || null,
          url: url.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't add that resource.");
      } else {
        setTitle("");
        setBody("");
        setUrl("");
        setOpen(false);
        await onChange();
      }
    } catch {
      setErr("Couldn't reach the studio — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`mt-6 ${primaryBtn}`}
      >
        + Add resource
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 rounded-2xl border border-dashed border-ink/20 bg-white/70 p-5"
    >
      <p className="text-[13px] font-medium text-ink/70">New resource</p>
      <div className="mt-3 space-y-3">
        <div>
          <label className={labelCls}>Kind</label>
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value as "doc" | "policy")}
          >
            <option value="doc">Training &amp; doc</option>
            <option value="policy">Store policy</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Title</label>
          <input
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Body</label>
          <textarea
            rows={4}
            className={inputCls}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Link (optional)</label>
          <input
            className={inputCls}
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className={primaryBtn}
        >
          {busy ? "Adding…" : "Add resource"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={outlineBtn}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ResourceCard({
  resource,
  onChange,
}: {
  resource: Resource;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState(resource.title);
  const [body, setBody] = useState(resource.body ?? "");
  const [url, setUrl] = useState(resource.url ?? "");

  async function patch(patchBody: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/resources/${resource.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't save that change.");
        return false;
      }
      await onChange();
      return true;
    } catch {
      setErr("Couldn't reach the studio — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const ok = await patch({
      title: title.trim(),
      body: body.trim() || null,
      url: url.trim() || null,
    });
    if (ok) setEditing(false);
  }

  async function archive() {
    if (!window.confirm(`Archive "${resource.title}"?`)) return;
    await patch({ archive: true });
  }

  return (
    <div className="rounded-2xl bg-white p-4">
      {!editing ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-[16px] font-bold">{resource.title}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => setEditing(true)} className={outlineBtn}>
                Edit
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
          {resource.body && (
            <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink/70">
              {resource.body}
            </p>
          )}
          {resource.url && (
            <a
              href={resource.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[13px] text-lavender-deep underline"
            >
              Open link
            </a>
          )}
          {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Title</label>
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Body</label>
            <textarea
              rows={4}
              className={inputCls}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Link (optional)</label>
            <input
              className={inputCls}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          {err && <p className="text-sm text-blush-deep">{err}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={saveEdit}
              disabled={busy || !title.trim()}
              className={primaryBtn}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setTitle(resource.title);
                setBody(resource.body ?? "");
                setUrl(resource.url ?? "");
              }}
              className={outlineBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingGrid({
  training,
  onChange,
}: {
  training: Training;
  onChange: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function toggle(memberId: number, stepKey: string, done: boolean) {
    const k = `${memberId}:${stepKey}`;
    setBusyKey(k);
    setErr("");
    try {
      const res = await fetch("/api/team/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, step_key: stepKey, done }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || "Couldn't save that change.");
      } else {
        await onChange();
      }
    } catch {
      setErr("Couldn't reach the studio — try again.");
    } finally {
      setBusyKey(null);
    }
  }

  if (training.members.length === 0) {
    return (
      <p className="mt-3 rounded-2xl bg-white p-4 text-sm text-ink/45">
        No team members to track yet.
      </p>
    );
  }
  if (training.steps.length === 0) {
    return (
      <p className="mt-3 rounded-2xl bg-white p-4 text-sm text-ink/45">
        No training steps set — add them in Team settings.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      {err && <p className="text-sm text-blush-deep">{err}</p>}
      {training.members.map((m) => {
        const prog = training.progress[String(m.id)] || {};
        return (
          <div key={m.id} className="rounded-2xl bg-white p-4">
            <p className="text-[16px] font-bold">{m.name}</p>
            <div className="mt-3 space-y-2">
              {training.steps.map((step) => {
                const cell = prog[step.key];
                const done = !!cell?.done;
                const k = `${m.id}:${step.key}`;
                return (
                  <button
                    key={step.key}
                    onClick={() => toggle(m.id, step.key, !done)}
                    disabled={busyKey === k}
                    className="flex w-full items-center gap-3 rounded-xl border border-ink/10 bg-cream/40 px-3 py-2.5 text-left text-[14px] disabled:opacity-40"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                        done
                          ? "border-sage-deep bg-sage-deep text-cream"
                          : "border-ink/25"
                      }`}
                    >
                      {done ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      {step.label}
                      {done && cell?.done_at && (
                        <span className="ml-2 text-[12px] text-ink/45">
                          {fmtDateTime(cell.done_at)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
