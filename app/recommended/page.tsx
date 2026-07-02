"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { Item, statusLabel } from "@/lib/types";

function Thumb({ item }: { item: Item }) {
  return (
    <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
      {item.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.photo_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
          {(item.name || item.brand).charAt(0)}
        </div>
      )}
    </div>
  );
}

export default function RecommendedPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => {
    (async () => {
      const [ir, rr] = await Promise.all([
        fetch("/api/items"),
        fetch("/api/recommended"),
      ]);
      if (ir.ok) setItems(await ir.json());
      if (rr.ok) setOrder((await rr.json()).order ?? []);
      setLoaded(true);
    })();
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  // Curated list (dropping any ids whose piece is gone), plus the pool of
  // pieces you can still add (anything showable in the shop, not already in).
  const ordered = order.map((id) => byId.get(id)).filter(Boolean) as Item[];
  const inOrder = new Set(order);
  const addable = items
    .filter(
      (i) =>
        !inOrder.has(i.id) &&
        i.status !== "retired" &&
        i.status !== "with_consignor"
    )
    .sort((a, b) => (a.name || a.brand).localeCompare(b.name || b.brand));

  function move(idx: number, dir: -1 | 1) {
    const to = idx + dir;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[idx], next[to]] = [next[to], next[idx]];
    setOrder(next);
    setSavedAt(false);
  }
  function remove(id: string) {
    setOrder(order.filter((x) => x !== id));
    setSavedAt(false);
  }
  function add(id: string) {
    setOrder([...order, id]);
    setSavedAt(false);
  }

  async function save() {
    setSaving(true);
    const res = await fetch("/api/recommended", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    if (res.ok) setSavedAt(true);
    setSaving(false);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-medium md:text-5xl">Recommended</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              Curate what customers see first. Top of the list shows first. Pieces
              you don&apos;t list fall back to newest-available.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || !loaded}
            className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save order"}
          </button>
        </div>
        {savedAt && (
          <p className="mt-3 text-sm text-sage-deep">Saved ✓ — live on the shop.</p>
        )}

        {!loaded ? (
          <div className="mt-8 h-64 animate-pulse rounded-2xl bg-ink/5" />
        ) : (
          <>
            <section className="mt-8">
              <h2 className="text-xl font-medium">
                In Recommended ({ordered.length})
              </h2>
              <div className="mt-3 space-y-2">
                {ordered.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    None curated yet — the shop shows newest-available first. Add
                    pieces below to hand-pick the order.
                  </p>
                ) : (
                  ordered.map((i, idx) => (
                    <div
                      key={i.id}
                      className="flex items-center gap-3 rounded-2xl bg-white p-3"
                    >
                      <span className="w-5 shrink-0 text-center text-sm text-ink/40">
                        {idx + 1}
                      </span>
                      <Thumb item={i} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">
                            {i.name || i.brand}
                          </span>{" "}
                          <span className="text-ink/50">
                            {i.id} · {i.size}
                          </span>
                        </p>
                        <p className="text-[12px] text-ink/45">{statusLabel(i.status)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => move(idx, -1)}
                          disabled={idx === 0}
                          className="rounded-full border border-ink/15 px-2.5 py-1 text-sm disabled:opacity-30"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => move(idx, 1)}
                          disabled={idx === ordered.length - 1}
                          className="rounded-full border border-ink/15 px-2.5 py-1 text-sm disabled:opacity-30"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => remove(i.id)}
                          className="ml-1 rounded-full px-2 text-lg leading-none text-ink/40 hover:bg-ink/5"
                          aria-label="Remove from Recommended"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-xl font-medium">Add a piece ({addable.length})</h2>
              <div className="mt-3 space-y-2">
                {addable.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                    Every showable piece is already in the list.
                  </p>
                ) : (
                  addable.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => add(i.id)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left hover:bg-white/70"
                    >
                      <Thumb item={i} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px]">
                          <span className="font-serif font-semibold">
                            {i.name || i.brand}
                          </span>{" "}
                          <span className="text-ink/50">
                            {i.id} · {i.size}
                          </span>
                        </p>
                        <p className="text-[12px] text-ink/45">{statusLabel(i.status)}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[13px] text-cream">
                        + Add
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
