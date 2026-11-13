"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";

// ---- Types (match the existing API responses) ------------------------------

type Resource = {
  id: number;
  kind: "doc" | "policy";
  title: string;
  body: string | null;
  url: string | null;
  position: number;
};

type Teammate = { id: number; name: string; phone: string | null };

type TrainingData = { steps: string[]; progress: Record<string, boolean> };

function Skeleton() {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
      ))}
    </div>
  );
}

export default function ResourcesPage() {
  useMe();

  const [resources, setResources] = useState<Resource[] | null>(null);
  const [directory, setDirectory] = useState<Teammate[]>([]);
  const [training, setTraining] = useState<TrainingData | null>(null);

  const load = useCallback(async () => {
    try {
      const [rr, dr, tr] = await Promise.all([
        fetch("/api/resources", { cache: "no-store" }),
        fetch("/api/directory", { cache: "no-store" }),
        fetch("/api/my-training", { cache: "no-store" }),
      ]);
      setResources(rr.ok ? await rr.json() : []);
      setDirectory(dr.ok ? await dr.json() : []);
      setTraining(tr.ok ? await tr.json() : { steps: [], progress: {} });
    } catch {
      setResources([]);
      setDirectory([]);
      setTraining({ steps: [], progress: {} });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loaded = resources !== null && training !== null;

  const docs = (resources ?? []).filter((r) => r.kind === "doc").sort((a, b) => a.position - b.position);
  const policies = (resources ?? [])
    .filter((r) => r.kind === "policy")
    .sort((a, b) => a.position - b.position);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Resources</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Training, store policies, the team directory, and your training progress.
        </p>

        {!loaded ? (
          <Skeleton />
        ) : (
          <div className="mt-6 space-y-10">
            <ResourceGroup title="Training & docs" items={docs} emptyLabel="No docs yet." />
            <ResourceGroup title="Store policies" items={policies} emptyLabel="No policies yet." />

            {/* Staff directory */}
            <section>
              <h2 className="text-2xl font-medium">Staff directory</h2>
              <div className="mt-3 space-y-2">
                {directory.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    No teammates listed.
                  </p>
                ) : (
                  directory.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4"
                    >
                      <span className="text-[15px] font-medium">{t.name}</span>
                      {t.phone ? (
                        <a href={`tel:${t.phone}`} className="text-[14px] text-ink/60 underline">
                          {t.phone}
                        </a>
                      ) : (
                        <span className="text-[13px] text-ink/40">—</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* My training */}
            <section>
              <h2 className="text-2xl font-medium">My training</h2>
              <p className="mt-0.5 text-[13px] text-ink/55">
                Your trainer checks these off as you go.
              </p>
              <div className="mt-3 space-y-2">
                {(training?.steps ?? []).length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    No training steps yet.
                  </p>
                ) : (
                  (training?.steps ?? []).map((step) => {
                    const done = !!training?.progress?.[step];
                    return (
                      <div
                        key={step}
                        className="flex items-center gap-3 rounded-2xl bg-white p-4"
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] ${
                            done
                              ? "bg-sage-deep text-cream"
                              : "border border-ink/20 bg-white text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className={`text-[15px] ${done ? "" : "text-ink/70"}`}>{step}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ResourceGroup({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: Resource[];
  emptyLabel: string;
}) {
  return (
    <section>
      <h2 className="text-2xl font-medium">{title}</h2>
      <div className="mt-3 space-y-2">
        {items.length === 0 ? (
          <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">{emptyLabel}</p>
        ) : (
          items.map((r) => (
            <div key={r.id} className="rounded-2xl bg-white p-4">
              <h3 className="text-[17px] font-medium">{r.title}</h3>
              {r.body && (
                <p className="mt-1.5 whitespace-pre-wrap text-[15px] text-ink/80">{r.body}</p>
              )}
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[14px] text-ink underline"
                >
                  Open link →
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
