"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { statusLabel, type ItemStatus } from "@/lib/types";

type FeaturedItem = {
  id: string;
  barcode: string | null;
  label: string;
  size: string;
  photo_url: string | null;
  status: ItemStatus;
  ownership: string;
  approval_status: string | null;
  rental_count: number;
  featured_rank: number | null;
};

// A featured piece is actually shown on the shop only if it's normally listed.
function shownOnShop(i: FeaturedItem): boolean {
  const listedStatus = ["available", "reserved", "rented"].includes(i.status);
  const approved = i.ownership !== "consignment" || i.approval_status === "approved";
  return listedStatus && approved;
}

export default function FeaturedManagerPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const router = useRouter();

  const [list, setList] = useState<FeaturedItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [err, setErr] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!meLoading && !isAdmin) router.replace("/inventory");
  }, [meLoading, isAdmin, router]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/featured");
        if (res.ok) setList(await res.json());
        else setErr("Couldn't load featured pieces.");
      } catch {
        setErr("Couldn't reach the studio — refresh to try again.");
      }
    })();
  }, []);

  function move(from: number, to: number) {
    setList((prev) => {
      if (!prev) return prev;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
    setSavedAt(false);
  }

  async function save() {
    if (!list) return;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/featured", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: list.map((i) => i.id) }),
      });
      if (res.ok) setSavedAt(true);
      else setErr("Couldn't save the order — try again.");
    } catch {
      setErr("Couldn't reach the studio — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await fetch(`/api/items/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_featured", featured: false }),
      });
      setList((prev) => (prev ?? []).filter((i) => i.id !== id));
    } catch {
      setErr("Couldn't remove that piece — try again.");
    }
  }

  if (meLoading || !isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl px-5 py-8 md:px-10 md:py-12">
          <div className="h-64 animate-pulse rounded-2xl bg-ink/5" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl font-medium md:text-5xl">Featured</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              These show in the shop&apos;s Featured section, top of the page, in
              this order. Star a piece from the Inventory grid to add it here. Drag
              (or use the arrows) to reorder, then Save.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || !list}
            className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save order"}
          </button>
        </div>
        {savedAt && <p className="mt-3 text-sm text-sage-deep">Saved ✓ — live on the shop.</p>}
        {err && <p className="mt-3 text-sm text-blush-deep">{err}</p>}

        {!list ? (
          <div className="mt-8 h-64 animate-pulse rounded-2xl bg-ink/5" />
        ) : list.length === 0 ? (
          <p className="mt-10 rounded-2xl bg-white p-5 text-center text-sm text-ink/50">
            No featured pieces yet. Open{" "}
            <Link href="/inventory" className="underline">Inventory</Link> and tap the ☆
            star on your best performers to feature them.
          </p>
        ) : (
          <div className="mt-8 space-y-2">
            {list.map((i, idx) => (
              <div
                key={i.id}
                draggable
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== idx) move(dragIndex, idx);
                  setDragIndex(null);
                }}
                className={`flex items-center gap-3 rounded-2xl bg-white p-3 ${
                  dragIndex === idx ? "opacity-50" : ""
                }`}
              >
                <span className="shrink-0 cursor-grab select-none px-1 text-ink/30" title="Drag to reorder">
                  ⠿
                </span>
                <span className="w-6 shrink-0 text-center text-sm tabular-nums text-ink/40">
                  {idx + 1}
                </span>
                <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                  {i.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
                      {i.label.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">
                    <span className="font-serif font-semibold">{i.label}</span>{" "}
                    <span className="text-ink/50">
                      {i.barcode || i.id} · {i.size}
                    </span>
                  </p>
                  <p className="text-[12px] text-ink/45">
                    Rented {i.rental_count}×
                    {!shownOnShop(i) && (
                      <span className="text-blush-deep"> · Hidden on shop ({statusLabel(i.status)})</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => move(idx, idx - 1)}
                    disabled={idx === 0}
                    className="rounded-full border border-ink/15 px-2.5 py-1 text-sm disabled:opacity-30"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(idx, idx + 1)}
                    disabled={idx === list.length - 1}
                    className="rounded-full border border-ink/15 px-2.5 py-1 text-sm disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => remove(i.id)}
                    className="ml-1 rounded-full px-2 text-lg leading-none text-ink/40 hover:bg-ink/5"
                    aria-label="Remove from Featured"
                    title="Remove from Featured"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
