"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import ItemForm from "@/components/ItemForm";
import {
  Item,
  Consignor,
  ItemStatus,
  STATUSES,
  TIERS,
  SIZES,
  EVENT_TYPES,
  tierLabel,
  statusLabel,
} from "@/lib/types";

const STATUS_STYLES: Record<ItemStatus, string> = {
  available: "bg-sage text-ink",
  reserved: "bg-lavender text-ink",
  rented: "bg-blush text-ink",
  cleaning: "bg-butter text-ink",
  retired: "bg-ink/10 text-ink/60",
};

function money(n: number | string): string {
  return `$${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;
}

export default function InventoryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [consignors, setConsignors] = useState<Consignor[]>([]);
  const [loadError, setLoadError] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<ItemStatus | "">("");
  const [fTier, setFTier] = useState("");
  const [fSize, setFSize] = useState("");
  const [fEvent, setFEvent] = useState("");
  const [fBrand, setFBrand] = useState("");

  // modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [ir, cr] = await Promise.all([
          fetch("/api/items"),
          fetch("/api/consignors"),
        ]);
        if (!ir.ok) throw new Error(`items ${ir.status}`);
        setItems(await ir.json());
        if (cr.ok) setConsignors(await cr.json());
      } catch {
        setLoadError("Couldn't load inventory — refresh to try again.");
      }
    })();
  }, []);

  const brands = useMemo(
    () =>
      Array.from(new Set((items ?? []).map((i) => i.brand))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [items]
  );

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (fStatus) list = list.filter((i) => i.status === fStatus);
    if (fTier) list = list.filter((i) => i.tier === fTier);
    if (fSize) list = list.filter((i) => i.size === fSize);
    if (fEvent) list = list.filter((i) => i.event_types?.includes(fEvent));
    if (fBrand) list = list.filter((i) => i.brand === fBrand);
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.brand.toLowerCase().includes(t) ||
          i.id.toLowerCase().includes(t) ||
          (i.color ?? "").toLowerCase().includes(t) ||
          (i.consignor_name ?? "").toLowerCase().includes(t)
      );
    }
    return list;
  }, [items, q, fStatus, fTier, fSize, fEvent, fBrand]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items ?? []) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  const hasFilters = q || fStatus || fTier || fSize || fEvent || fBrand;

  function openAdd() {
    setEditingItem(null);
    setFormOpen(true);
  }
  function handleSaved(saved: Item) {
    setItems((prev) => {
      const list = prev ?? [];
      const idx = list.findIndex((i) => i.id === saved.id);
      if (idx === -1) return [saved, ...list];
      const next = [...list];
      next[idx] = saved;
      return next;
    });
    setFormOpen(false);
  }
  function handleDeleted(id: string) {
    setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
    setFormOpen(false);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-medium md:text-5xl">Inventory</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              {items === null
                ? "Loading…"
                : `${items.length} piece${items.length === 1 ? "" : "s"} in the collection`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-transform active:scale-[0.98]"
          >
            + Add piece
          </button>
        </div>

        {/* Status chips */}
        <div className="mt-7 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          <button
            onClick={() => setFStatus("")}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${
              fStatus === "" ? "bg-ink text-cream" : "bg-white text-ink/60"
            }`}
          >
            All {items ? `· ${items.length}` : ""}
          </button>
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setFStatus(fStatus === s.value ? "" : s.value)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${
                fStatus === s.value
                  ? "bg-ink text-cream"
                  : `${STATUS_STYLES[s.value]} opacity-90`
              }`}
            >
              {s.label} · {counts[s.value] ?? 0}
            </button>
          ))}
        </div>

        {/* Search + filters */}
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search brand, ID, color…"
            className="min-w-44 flex-1 rounded-full border border-ink/15 bg-white px-4.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
          />
          <select
            value={fTier}
            onChange={(e) => setFTier(e.target.value)}
            className="rounded-full border border-ink/15 bg-white px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">Tier</option>
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} ${t.price}
              </option>
            ))}
          </select>
          <select
            value={fSize}
            onChange={(e) => setFSize(e.target.value)}
            className="rounded-full border border-ink/15 bg-white px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">Size</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={fEvent}
            onChange={(e) => setFEvent(e.target.value)}
            className="rounded-full border border-ink/15 bg-white px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">Event</option>
            {EVENT_TYPES.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </select>
          <select
            value={fBrand}
            onChange={(e) => setFBrand(e.target.value)}
            className="max-w-40 rounded-full border border-ink/15 bg-white px-3.5 py-2.5 text-sm outline-none"
          >
            <option value="">Brand</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={() => {
                setQ("");
                setFStatus("");
                setFTier("");
                setFSize("");
                setFEvent("");
                setFBrand("");
              }}
              className="rounded-full px-3.5 py-2.5 text-sm text-ink/50 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        {/* Grid */}
        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : items === null ? (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] animate-pulse rounded-2xl bg-ink/5"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-20 text-center">
            <p className="font-serif text-3xl italic text-ink/40">
              {items.length === 0
                ? "The racks are empty"
                : "Nothing matches those filters"}
            </p>
            <p className="mt-2 text-sm text-ink/40">
              {items.length === 0
                ? "Add your first piece to start the collection."
                : "Try clearing a filter or two."}
            </p>
            {items.length === 0 && (
              <button
                onClick={openAdd}
                className="mt-6 rounded-full bg-ink px-6 py-3 text-[15px] text-cream"
              >
                + Add your first piece
              </button>
            )}
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((item) => (
              <Link
                key={item.id}
                href={`/inventory/${encodeURIComponent(item.barcode || item.id)}`}
                className="group text-left"
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-white">
                  {item.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.photo_url}
                      alt={`${item.brand} ${item.color ?? ""}`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-lavender/40">
                      <span className="font-serif text-5xl italic text-ink/25">
                        {item.brand.charAt(0)}
                      </span>
                    </div>
                  )}
                  <span
                    className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[item.status]}`}
                  >
                    {statusLabel(item.status)}
                  </span>
                  {item.ownership === "consignment" && (
                    <span className="absolute right-2.5 top-2.5 rounded-full bg-cream/90 px-2 py-1 text-[10px] uppercase tracking-wider text-ink/60">
                      Consign
                    </span>
                  )}
                </div>
                <div className="px-1 pt-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-serif text-lg font-semibold leading-tight">
                      {item.brand}
                    </span>
                    <span className="shrink-0 text-[15px]">
                      {money(item.rental_price)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink/50">
                    <span className="font-mono">{item.barcode || item.id}</span> ·{" "}
                    {item.size}
                    {item.color ? ` · ${item.color}` : ""} ·{" "}
                    {tierLabel(item.tier)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <ItemForm
          item={editingItem}
          consignors={consignors}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onConsignorAdded={(c) => setConsignors((prev) => [...prev, c])}
        />
      )}
    </AppShell>
  );
}
