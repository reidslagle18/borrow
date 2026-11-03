"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import ItemForm from "@/components/ItemForm";
import { GlobalSearch } from "@/components/StudioTools";
import { useMe } from "@/lib/useMe";
import {
  Item,
  Consignor,
  ItemStatus,
  Occasion,
  STATUSES,
  SIZES,
  EVENT_TYPES,
  statusLabel,
} from "@/lib/types";

const STATUS_STYLES: Record<ItemStatus, string> = {
  available: "bg-sage text-ink",
  reserved: "bg-lavender text-ink",
  rented: "bg-blush text-ink",
  consignor_hold: "bg-blush-deep/25 text-ink",
  cleaning: "bg-butter text-ink",
  retired: "bg-ink/10 text-ink/60",
  with_consignor: "bg-lavender-deep/30 text-ink",
  in_storage: "bg-ink/10 text-ink/60",
};

function money(n: number | string): string {
  return `$${Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2)}`;
}

// Module-level cache so returning from a piece's detail page renders the list
// instantly (no skeleton, no height collapse) — which is what lets us restore
// the exact scroll position instead of snapping to the top.
let cachedItems: Item[] | null = null;
let cachedConsignors: Consignor[] = [];
const SCROLL_KEY = "inventory_scroll";
const ORDER_KEY = "inventory_order";

export default function InventoryPage() {
  const { me } = useMe();
  const isAdmin = me?.role === "admin";
  const [items, setItems] = useState<Item[] | null>(cachedItems);
  const [consignors, setConsignors] = useState<Consignor[]>(cachedConsignors);
  const [loadError, setLoadError] = useState("");
  const restoredScroll = useRef(false);

  // filters
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<ItemStatus | "">("");
  const [fSize, setFSize] = useState("");
  const [fEvent, setFEvent] = useState("");
  const [fBrand, setFBrand] = useState("");

  // modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  // bulk occasion tagging
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOccasion, setBulkOccasion] = useState("");
  const [bulkSub, setBulkSub] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

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
        // Keep any cached list on screen; only show the error if we have nothing.
        if (!cachedItems) setLoadError("Couldn't load inventory — refresh to try again.");
      }
    })();
  }, []);

  // Occasion config for the bulk-tag picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const d = await res.json();
        if (Array.isArray(d?.program?.occasions)) setOccasions(d.program.occasions);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  // Keep the module cache mirroring the latest data.
  useEffect(() => {
    if (items) cachedItems = items;
  }, [items]);
  useEffect(() => {
    if (consignors.length) cachedConsignors = consignors;
  }, [consignors]);

  // Restore the scroll position saved when a piece was opened, once the list
  // is on screen — so closing a piece returns you right where you were.
  useEffect(() => {
    if (restoredScroll.current || items === null) return;
    restoredScroll.current = true;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      sessionStorage.removeItem(SCROLL_KEY);
      const y = parseInt(saved, 10);
      if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [items]);

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
    if (fSize) list = list.filter((i) => i.size === fSize);
    if (fEvent) list = list.filter((i) => i.event_types?.includes(fEvent));
    if (fBrand) list = list.filter((i) => i.brand === fBrand);
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.brand.toLowerCase().includes(t) ||
          (i.name ?? "").toLowerCase().includes(t) ||
          i.id.toLowerCase().includes(t) ||
          (i.color ?? "").toLowerCase().includes(t) ||
          (i.consignor_name ?? "").toLowerCase().includes(t)
      );
    }
    return list;
  }, [items, q, fStatus, fSize, fEvent, fBrand]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items ?? []) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  const hasFilters = q || fStatus || fSize || fEvent || fBrand;

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

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Star / un-star a piece as Featured (admin only), straight from its card.
  const [featBusy, setFeatBusy] = useState<string | null>(null);
  async function toggleFeatured(item: Item, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFeatBusy(item.id);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_featured", featured: !item.featured }),
      });
      if (res.ok) {
        const saved = (await res.json()) as Item;
        setItems((prev) =>
          (prev ?? []).map((i) => (i.id === saved.id ? { ...i, featured: saved.featured, featured_rank: saved.featured_rank } : i))
        );
      }
    } finally {
      setFeatBusy(null);
    }
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
    setBulkOccasion("");
    setBulkSub("");
    setBulkMsg("");
  }

  const bulkSubOptions =
    occasions.find((o) => o.name === bulkOccasion)?.subs ?? [];

  async function applyBulkTag(mode: "add" | "remove") {
    if (selected.size === 0 || !bulkOccasion) return;
    setBulkBusy(true);
    setBulkMsg("");
    try {
      const res = await fetch("/api/items/bulk-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selected),
          occasion: bulkOccasion,
          sub: bulkSub || undefined,
          mode,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setBulkMsg(d.error || "Couldn't apply — try again.");
        return;
      }
      // Refresh so the new tags are reflected, then keep the selection so the
      // owner can apply another tag to the same batch.
      const ir = await fetch("/api/items");
      if (ir.ok) setItems(await ir.json());
      const label = bulkSub ? `${bulkOccasion} → ${bulkSub}` : bulkOccasion;
      setBulkMsg(
        `${mode === "add" ? "Tagged" : "Removed"} ${selected.size} piece${
          selected.size === 1 ? "" : "s"
        } ${mode === "add" ? "with" : "from"} “${label}”.`
      );
    } catch {
      setBulkMsg("Couldn't reach the server — try again.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl font-medium md:text-5xl">Inventory</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              {items === null
                ? "Loading…"
                : `${items.length} piece${items.length === 1 ? "" : "s"} in the collection`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              className={`rounded-full border px-5 py-3 text-[15px] transition-colors ${
                selectMode
                  ? "border-ink bg-ink text-cream"
                  : "border-ink/15 bg-white text-ink/70 hover:border-ink/35"
              }`}
            >
              {selectMode ? "Done" : "Select · tag"}
            </button>
            {isAdmin && (
              <button
                onClick={openAdd}
                className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-transform active:scale-[0.98]"
              >
                + Add piece
              </button>
            )}
          </div>
        </div>

        {/* Look up a piece — live suggestions, barcode-aware, scan-ready. */}
        <div className="mt-6">
          <GlobalSearch variant="inline" />
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
            {filtered.map((item) => {
              const isSel = selected.has(item.id);
              const cardBody = (
                <>
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
                    {selectMode ? (
                      <span
                        className={`absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[14px] font-bold ${
                          isSel
                            ? "border-ink bg-ink text-cream"
                            : "border-white bg-ink/20 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    ) : (
                      item.ownership === "consignment" && (
                        <span className="absolute right-2.5 top-2.5 rounded-full bg-cream/90 px-2 py-1 text-[10px] uppercase tracking-wider text-ink/60">
                          Consign
                        </span>
                      )
                    )}
                    <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-1.5">
                      {item.featured && (
                        <span className="rounded-full bg-[#b8860b] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-cream">
                          ★ Featured
                        </span>
                      )}
                      {item.new_with_tags && (
                        <span className="rounded-full bg-sage-deep px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-cream">
                          NWT
                        </span>
                      )}
                    </div>
                    {isAdmin && !selectMode && (
                      <button
                        type="button"
                        onClick={(e) => toggleFeatured(item, e)}
                        disabled={featBusy === item.id}
                        aria-label={item.featured ? "Remove from Featured" : "Mark as Featured"}
                        title={item.featured ? "Remove from Featured" : "Mark as Featured"}
                        className={`absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-cream/90 text-[16px] leading-none shadow-sm transition-transform hover:scale-110 disabled:opacity-50 ${
                          item.featured ? "text-[#b8860b]" : "text-ink/40"
                        }`}
                      >
                        {item.featured ? "★" : "☆"}
                      </button>
                    )}
                  </div>
                  <div className="px-1 pt-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-serif text-lg font-semibold leading-tight">
                        {item.name || item.brand}
                      </span>
                      <span className="shrink-0 text-[15px]">
                        {money(item.rental_price)}
                        <span className="text-[11px] text-ink/40"> rent</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink/50">
                      {item.name ? `${item.brand} · ` : ""}
                      <span className="font-mono">{item.barcode || item.id}</span> ·{" "}
                      {item.size}
                      {item.color ? ` · ${item.color}` : ""}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink/55">
                      {item.retail_value != null
                        ? `Retails for ${money(item.retail_value)}`
                        : "Retail value not set"}
                    </p>
                  </div>
                </>
              );
              if (selectMode) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleSelected(item.id)}
                    className={`group rounded-2xl text-left transition-shadow ${
                      isSel ? "ring-2 ring-ink ring-offset-2 ring-offset-cream" : ""
                    }`}
                  >
                    {cardBody}
                  </button>
                );
              }
              return (
                <Link
                  key={item.id}
                  href={`/inventory/${encodeURIComponent(item.barcode || item.id)}`}
                  onClick={() => {
                    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
                    // Save the order currently on screen so the piece page can
                    // step to the next/previous piece in this same view.
                    sessionStorage.setItem(
                      ORDER_KEY,
                      JSON.stringify(filtered.map((i) => i.barcode || i.id))
                    );
                  }}
                  className="group text-left"
                >
                  {cardBody}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-cream/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium">
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Set(filtered.map((i) => i.id)))}
              className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-[13px] text-ink/70"
            >
              Select all ({filtered.length})
            </button>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="rounded-full px-2 py-1.5 text-[13px] text-ink/50 underline underline-offset-2"
              >
                Clear
              </button>
            )}
            <span className="mx-1 hidden h-5 w-px bg-ink/10 sm:block" />
            <select
              value={bulkOccasion}
              onChange={(e) => {
                setBulkOccasion(e.target.value);
                setBulkSub("");
              }}
              className="rounded-full border border-ink/15 bg-white px-3.5 py-2 text-sm outline-none"
            >
              <option value="">Occasion…</option>
              {occasions.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </select>
            {bulkSubOptions.length > 0 && (
              <select
                value={bulkSub}
                onChange={(e) => setBulkSub(e.target.value)}
                className="rounded-full border border-ink/15 bg-white px-3.5 py-2 text-sm outline-none"
              >
                <option value="">(whole occasion)</option>
                {bulkSubOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <button
              disabled={bulkBusy || selected.size === 0 || !bulkOccasion}
              onClick={() => applyBulkTag("add")}
              className="rounded-full bg-ink px-4 py-2 text-sm text-cream disabled:opacity-40"
            >
              {bulkBusy ? "Working…" : "Apply tag"}
            </button>
            <button
              disabled={bulkBusy || selected.size === 0 || !bulkOccasion}
              onClick={() => applyBulkTag("remove")}
              className="rounded-full border border-ink/15 bg-white px-4 py-2 text-sm text-ink/60 disabled:opacity-40"
            >
              Remove
            </button>
            {bulkMsg && (
              <span className="w-full text-[13px] text-sage-deep sm:w-auto">{bulkMsg}</span>
            )}
          </div>
        </div>
      )}

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
