"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import ItemForm from "@/components/ItemForm";
import { useMe } from "@/lib/useMe";
import {
  Item,
  Consignor,
  ItemStatus,
  statusLabel,
  ownershipLabel,
} from "@/lib/types";
import { fmtShort, dateOnly } from "@/lib/dates";

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

function money(n: number | string | null): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  return isNaN(date.getTime()) ? d : date.toLocaleDateString();
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.15em] text-ink/45">
        {label}
      </dt>
      <dd className="mt-1 text-[15px] text-ink/80">
        {value === null || value === undefined || value === "" ? (
          <span className="text-ink/30">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-white/60 p-5">
      <h2 className="mb-4 font-serif text-xl italic text-ink/70">{title}</h2>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        {children}
      </dl>
    </section>
  );
}

export default function PieceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const key = decodeURIComponent(params.id);

  const [item, setItem] = useState<Item | null>(null);
  const [consignors, setConsignors] = useState<Consignor[]>([]);
  const [loadError, setLoadError] = useState("");
  const [activePhoto, setActivePhoto] = useState(0);
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState(0);
  // Ordered keys of the inventory view you came from, so we can step to the
  // next/previous piece without going back to the grid.
  const [order, setOrder] = useState<string[]>([]);
  // "Ask consignor to pick up" (under-performing piece) action state.
  const [confirmPickup, setConfirmPickup] = useState(false);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [pickupErr, setPickupErr] = useState("");
  // Consignor return / temporary-lend actions.
  const [caBusy, setCaBusy] = useState(false);
  const [caErr, setCaErr] = useState("");

  // Role: staff can view + update status/location, but not open the full (price)
  // edit form or see cost/replacement values.
  const { me } = useMe();
  const isAdmin = me?.role === "admin";
  const [staffEdit, setStaffEdit] = useState(false);
  const [sfStatus, setSfStatus] = useState<ItemStatus | "">("");
  const [sfLocation, setSfLocation] = useState("");
  const [sfBusy, setSfBusy] = useState(false);
  const [sfErr, setSfErr] = useState("");

  function openStaffEdit() {
    if (!item) return;
    setSfStatus(item.status);
    setSfLocation(item.location ?? "");
    setSfErr("");
    setStaffEdit(true);
  }
  async function saveStaffFields() {
    if (!item) return;
    setSfBusy(true);
    setSfErr("");
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_fields",
          status: sfStatus || item.status,
          location: sfLocation.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setItem(d);
        setStaffEdit(false);
      } else {
        setSfErr(d.error || "Couldn't update — try again.");
      }
    } catch {
      setSfErr("Couldn't reach the studio — try again.");
    } finally {
      setSfBusy(false);
    }
  }

  // Mark a consignment piece for dry cleaning before listing (deducts the
  // Cleaning & Care Fee from the consignor) — available for a few days after
  // intake in case it was missed on the form.
  const [cleanMsg, setCleanMsg] = useState("");
  async function markInitialClean() {
    if (!item) return;
    setCaBusy(true);
    setCleanMsg("");
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initial_clean" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setItem((prev) => (prev ? { ...prev, initial_cleaned: true } : prev));
        setCleanMsg(
          d.already
            ? "Already marked for dry cleaning."
            : `Marked for dry cleaning — ${money(d.amount)} deducted from the consignor's earnings.`
        );
      } else {
        setCleanMsg(d.error || "Couldn't mark it — try again.");
      }
    } catch {
      setCleanMsg("Couldn't reach the studio — try again.");
    } finally {
      setCaBusy(false);
    }
  }

  async function consignorAction(
    action: string,
    confirmMsg?: string,
    extra?: Record<string, unknown>
  ) {
    if (!item) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setCaBusy(true);
    setCaErr("");
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(extra || {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setItem(d);
      else setCaErr(d.error || "Couldn't update this piece — try again.");
    } catch {
      setCaErr("Couldn't reach the studio — check your connection.");
    } finally {
      setCaBusy(false);
    }
  }

  async function requestPickup() {
    if (!item) return;
    setPickupBusy(true);
    setPickupErr("");
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_pickup" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setItem(d);
        setConfirmPickup(false);
      } else {
        setPickupErr(d.error || "Couldn't send the request — try again.");
      }
    } catch {
      setPickupErr("Couldn't reach the studio — check your connection.");
    } finally {
      setPickupBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [ir, cr] = await Promise.all([
          fetch(`/api/items/${encodeURIComponent(key)}`),
          fetch("/api/consignors"),
        ]);
        if (!ir.ok) throw new Error(`item ${ir.status}`);
        setItem(await ir.json());
        if (cr.ok) setConsignors(await cr.json());
        const sr = await fetch("/api/settings");
        if (sr.ok) {
          const s = await sr.json();
          if (s.program?.turnaround_days != null) setBuffer(Number(s.program.turnaround_days));
        }
      } catch {
        setLoadError("Couldn't load this piece — it may have been removed.");
      }
    })();
  }, [key]);

  // Load the browsing order once. Prefer the exact filtered view saved when a
  // card was tapped; otherwise fall back to the full inventory (newest first,
  // matching the grid's default) so prev/next still works on a direct visit.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("inventory_order");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) {
          setOrder(parsed);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    (async () => {
      const r = await fetch("/api/items");
      if (r.ok) {
        const data: Item[] = await r.json();
        setOrder(data.map((i) => i.barcode || i.id));
      }
    })();
  }, []);

  const idx = order.indexOf(key);
  const prevKey = idx > 0 ? order[idx - 1] : null;
  const nextKey = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;

  const goto = useCallback(
    (k: string | null) => {
      if (k) router.push(`/inventory/${encodeURIComponent(k)}`);
    },
    [router]
  );

  // Left/right arrow keys step between pieces (ignored while editing or typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft" && prevKey) goto(prevKey);
      if (e.key === "ArrowRight" && nextKey) goto(nextKey);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevKey, nextKey, editing, goto]);

  const gallery = item
    ? item.photos?.length
      ? item.photos
      : item.photo_url
        ? [item.photo_url]
        : []
    : [];

  // Prev/Next control cluster, reused at the top and bottom of the page.
  const pieceNav = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => goto(prevKey)}
        disabled={!prevKey}
        className="rounded-full border border-ink/15 bg-white px-3.5 py-2 text-[13px] text-ink/70 transition-opacity disabled:opacity-30"
      >
        ← Prev
      </button>
      {idx >= 0 && order.length > 0 && (
        <span className="px-1 text-[12px] text-ink/40">
          {idx + 1} of {order.length}
        </span>
      )}
      <button
        onClick={() => goto(nextKey)}
        disabled={!nextKey}
        className="rounded-full border border-ink/15 bg-white px-3.5 py-2 text-[13px] text-ink/70 transition-opacity disabled:opacity-30"
      >
        Next →
      </button>
    </div>
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/inventory"
            scroll={false}
            className="text-sm text-ink/50 underline-offset-2 hover:underline"
          >
            ← Inventory
          </Link>
          {!loadError && item && pieceNav}
        </div>

        {loadError ? (
          <p className="mt-20 text-center text-ink/50">{loadError}</p>
        ) : item === null ? (
          <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,2fr)_3fr]">
            <div className="aspect-[3/4] animate-pulse rounded-2xl bg-ink/5" />
            <div className="space-y-4">
              <div className="h-10 w-2/3 animate-pulse rounded bg-ink/5" />
              <div className="h-40 animate-pulse rounded-2xl bg-ink/5" />
              <div className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="font-serif text-4xl font-medium md:text-5xl">
                    {item.name || item.brand}
                  </h1>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[item.status]}`}
                  >
                    {statusLabel(item.status)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink/50">
                  <span className="font-mono">{item.barcode || item.id}</span>
                  {item.silhouette ? ` · ${item.silhouette}` : ""} · {item.size}
                  {item.color ? ` · ${item.color}` : ""}
                </p>
              </div>
              {isAdmin ? (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-transform active:scale-[0.98]"
                >
                  Edit piece
                </button>
              ) : (
                <button
                  onClick={openStaffEdit}
                  className="rounded-full border border-ink/20 px-6 py-3 text-[15px] text-ink/70 transition-transform active:scale-[0.98]"
                >
                  Update status / location
                </button>
              )}
            </div>

            {/* Staff quick-edit: status + location only (no price fields). */}
            {staffEdit && !isAdmin && item && (
              <div className="mt-4 rounded-2xl border border-ink/15 bg-white/70 p-4">
                <p className="text-[14px] font-medium">Update status &amp; location</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50">
                      Status
                    </label>
                    <select
                      value={sfStatus}
                      onChange={(e) => setSfStatus(e.target.value as ItemStatus)}
                      className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
                    >
                      {(
                        [
                          "available",
                          "reserved",
                          "rented",
                          "cleaning",
                          "consignor_hold",
                          "with_consignor",
                          "in_storage",
                          "retired",
                        ] as ItemStatus[]
                      ).map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50">
                      Location
                    </label>
                    <input
                      value={sfLocation}
                      onChange={(e) => setSfLocation(e.target.value)}
                      placeholder="e.g. Rack 3"
                      className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
                    />
                  </div>
                </div>
                {sfErr && <p className="mt-2 text-[13px] text-blush-deep">{sfErr}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={saveStaffFields}
                    disabled={sfBusy}
                    className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
                  >
                    {sfBusy ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setStaffEdit(false)}
                    disabled={sfBusy}
                    className="rounded-full border border-ink/15 px-5 py-2.5 text-[14px] text-ink/60 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {buffer > 0 && (
              <p className="mt-3 rounded-xl bg-butter/40 px-4 py-2.5 text-[13px] text-ink/70">
                {item.status === "cleaning"
                  ? `In cleaning/turnaround — held ${buffer} day${buffer === 1 ? "" : "s"} after its return before it's bookable again.`
                  : `Cleaning/turnaround buffer: ${buffer} day${buffer === 1 ? "" : "s"} after each return before this piece is bookable again.`}
              </p>
            )}

            {/* Dry-clean-before-listing — markable for 3 days after intake, in
                case it was missed on the add form. */}
            {item.ownership === "consignment" &&
              !item.initial_cleaned &&
              item.created_at &&
              Date.now() - new Date(item.created_at).getTime() < 3 * 86_400_000 && (
                <div className="mt-3 rounded-2xl border border-sage-deep/40 bg-sage/20 p-4">
                  <p className="text-[14px] font-medium">Dry clean before listing?</p>
                  <p className="mt-0.5 text-[13px] text-ink/60">
                    Marks this piece for an initial dry clean — the Cleaning &amp;
                    Care Fee is deducted from{" "}
                    {item.consignor_name ?? "the consignor"}&apos;s earnings.
                    Available for 3 days after intake.
                  </p>
                  <button
                    onClick={markInitialClean}
                    disabled={caBusy}
                    className="mt-2.5 rounded-full border border-sage-deep bg-sage px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-40"
                  >
                    {caBusy ? "…" : "Mark for dry cleaning"}
                  </button>
                </div>
              )}
            {cleanMsg && (
              <p className="mt-2 text-[13px] text-sage-deep">{cleanMsg}</p>
            )}

            {/* Ask the consignor to collect an under-performing piece */}
            {item.ownership === "consignment" &&
              item.status !== "retired" &&
              item.status !== "with_consignor" &&
              item.status !== "consignor_hold" && (
                <div className="mt-3 rounded-2xl border border-ink/10 bg-white/60 p-4">
                  {item.pickup_requested_at ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[14px] text-ink/70">
                        ✓ Pickup requested{" "}
                        {fmtDate(item.pickup_requested_at) !== "—"
                          ? `on ${fmtDate(item.pickup_requested_at)}`
                          : ""}
                        {" — "}
                        {item.consignor_name ?? "the consignor"} was emailed to
                        come collect this piece.
                      </p>
                      <button
                        onClick={requestPickup}
                        disabled={pickupBusy}
                        className="shrink-0 rounded-full border border-ink/15 px-4 py-2 text-[13px] text-ink/60 disabled:opacity-40"
                      >
                        {pickupBusy ? "Sending…" : "Send a reminder"}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[14px] font-medium">
                        Not renting the way you&apos;d like?
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink/55">
                        Rented {item.rental_count}× since{" "}
                        {fmtDate(item.created_at)}. Email{" "}
                        {item.consignor_name ?? "the consignor"} to come pick it
                        up — the piece stays live until they collect it.
                      </p>
                      {!confirmPickup ? (
                        <button
                          onClick={() => {
                            setConfirmPickup(true);
                            setPickupErr("");
                          }}
                          className="mt-2.5 rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream"
                        >
                          Ask consignor to pick up
                        </button>
                      ) : (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-ink/70">
                            Email {item.consignor_name ?? "the consignor"} now?
                          </span>
                          <button
                            onClick={requestPickup}
                            disabled={pickupBusy}
                            className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40"
                          >
                            {pickupBusy ? "Sending…" : "Yes, send the email"}
                          </button>
                          <button
                            onClick={() => setConfirmPickup(false)}
                            disabled={pickupBusy}
                            className="rounded-full border border-ink/15 px-4 py-2 text-[13px] text-ink/60 disabled:opacity-40"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {pickupErr && (
                        <p className="mt-2 text-[13px] text-blush-deep">{pickupErr}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

            {/* Get this piece back to its consignor — for good, or lent out
                temporarily (held off the rack until it's returned). */}
            {item.ownership === "consignment" && item.status !== "retired" && (
              <div className="mt-3 rounded-2xl border border-ink/10 bg-white/60 p-4">
                {item.status === "consignor_hold" ? (
                  <div>
                    <p className="text-[14px] font-medium">
                      On hold for {item.consignor_name ?? "the consignor"}
                      {item.hold_start
                        ? ` · ${fmtShort(dateOnly(item.hold_start))}${
                            item.hold_end && item.hold_end !== item.hold_start
                              ? ` – ${fmtShort(dateOnly(item.hold_end))}`
                              : ""
                          }`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink/55">
                      Not rentable until you mark it returned. No late fee applies —
                      it simply stays on hold until it&apos;s back, however long that
                      takes.
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          consignorAction(
                            "hold_return",
                            `Mark ${item.name || item.brand} returned clean and back on the rack?`,
                            { needs_cleaning: false }
                          )
                        }
                        disabled={caBusy}
                        className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40"
                      >
                        Returned clean
                      </button>
                      <button
                        onClick={() =>
                          consignorAction(
                            "hold_return",
                            `Mark ${item.name || item.brand} returned and send it to cleaning? The cleaning fee will be deducted from ${item.consignor_name ?? "the consignor"}'s earnings.`,
                            { needs_cleaning: true }
                          )
                        }
                        disabled={caBusy}
                        className="rounded-full border border-ink/20 px-4 py-2 text-[13px] text-ink/60 disabled:opacity-40"
                      >
                        Returned needs cleaning
                      </button>
                    </div>
                    {caErr && <p className="mt-2 text-[13px] text-blush-deep">{caErr}</p>}
                  </div>
                ) : item.status === "with_consignor" ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[14px] text-ink/70">
                      Out with {item.consignor_name ?? "the consignor"} right now —
                      not rentable until it comes back.
                    </p>
                    <button
                      onClick={() => consignorAction("consignor_return")}
                      disabled={caBusy}
                      className="shrink-0 rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40"
                    >
                      {caBusy ? "…" : "Consignor returned it"}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-[14px] font-medium">
                      Getting this piece back to {item.consignor_name ?? "the consignor"}?
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink/55">
                      Hand it back for good, or lend it out temporarily — a lent
                      piece is held off the rack (not rentable) until she brings it
                      back, then one tap puts it back in rotation.
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          consignorAction(
                            "return_to_consignor",
                            `Give ${item.name || item.brand} back to ${item.consignor_name ?? "the consignor"} for good? It will be retired from the closet.`
                          )
                        }
                        disabled={caBusy}
                        className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40"
                      >
                        Gave it back (for good)
                      </button>
                      {["available", "reserved", "cleaning"].includes(item.status) && (
                        <button
                          onClick={() =>
                            consignorAction(
                              "consignor_take",
                              `Lend ${item.name || item.brand} to ${item.consignor_name ?? "the consignor"} temporarily? It won't be rentable until she brings it back.`
                            )
                          }
                          disabled={caBusy}
                          className="rounded-full border border-ink/20 px-4 py-2 text-[13px] text-ink/60 disabled:opacity-40"
                        >
                          Lend temporarily
                        </button>
                      )}
                    </div>
                    {caErr && (
                      <p className="mt-2 text-[13px] text-blush-deep">{caErr}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,2fr)_3fr]">
              {/* Gallery */}
              <div>
                <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-white">
                  {gallery.length ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={gallery[activePhoto] ?? gallery[0]}
                      alt={`${item.brand} ${item.color ?? ""}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-lavender/40">
                      <span className="font-serif text-6xl italic text-ink/25">
                        {item.brand.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>
                {gallery.length > 1 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {gallery.map((url, i) => (
                      <button
                        key={url}
                        onClick={() => setActivePhoto(i)}
                        className={`aspect-square overflow-hidden rounded-lg border-2 ${
                          i === activePhoto
                            ? "border-ink"
                            : "border-transparent opacity-70"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`${item.brand} ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fields */}
              <div className="space-y-5">
                {item.description && (
                  <p className="text-[15px] leading-relaxed text-ink/70">
                    {item.description}
                  </p>
                )}

                <Section title="Details">
                  <Field label="Brand" value={item.brand} />
                  <Field label="Silhouette" value={item.silhouette} />
                  <Field
                    label="Condition"
                    value={
                      item.new_with_tags ? (
                        <span className="rounded-full bg-sage/60 px-2.5 py-0.5 text-[12px]">
                          New with tags
                        </span>
                      ) : null
                    }
                  />
                  <Field label="Size" value={item.size} />
                  <Field label="Color(s)" value={item.color} />
                  <Field label="Fabric" value={item.fabric} />
                  <Field label="Fit notes" value={item.fit_notes} />
                  <Field
                    label="Event tags"
                    value={
                      item.event_types?.length ? (
                        <span className="flex flex-wrap gap-1.5">
                          {item.event_types.map((ev) => (
                            <span
                              key={ev}
                              className="rounded-full bg-sage/60 px-2.5 py-0.5 text-[12px]"
                            >
                              {ev}
                            </span>
                          ))}
                        </span>
                      ) : null
                    }
                  />
                </Section>

                <Section title="Pricing">
                  <Field label="Rental price" value={money(item.rental_price)} />
                  <Field label="Retail value" value={money(item.retail_value)} />
                  {isAdmin && (
                    <Field
                      label="Replacement value"
                      value={
                        money(item.replacement_value) +
                        (item.replacement_value_manual ? " · set" : " · auto")
                      }
                    />
                  )}
                </Section>

                <Section title="Ownership & sourcing">
                  <Field
                    label="Ownership"
                    value={ownershipLabel(item.ownership)}
                  />
                  {item.ownership === "consignment" && (
                    <Field label="Consignor" value={item.consignor_name} />
                  )}
                  {isAdmin && (
                    <Field label="Acquisition cost" value={money(item.purchase_cost)} />
                  )}
                  <Field
                    label="Acquired"
                    value={fmtDate(item.acquisition_date)}
                  />
                  <Field label="Source" value={item.source} />
                </Section>

                <Section title="Lifecycle">
                  <Field label="Current location" value={item.location} />
                  <Field label="Rental count" value={item.rental_count} />
                  <Field label="Cleaning count" value={item.cleaning_count} />
                  <Field label="Date added" value={fmtDate(item.created_at)} />
                  <Field label="Date retired" value={fmtDate(item.retired_at)} />
                </Section>

                {item.condition_notes && (
                  <Section title="Condition / damage">
                    <div className="col-span-full">
                      <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink/70">
                        {item.condition_notes}
                      </p>
                    </div>
                  </Section>
                )}
              </div>
            </div>

            {(prevKey || nextKey) && (
              <div className="mt-10 flex items-center justify-center border-t border-ink/10 pt-6">
                {pieceNav}
              </div>
            )}
          </>
        )}
      </div>

      {editing && item && (
        <ItemForm
          item={item}
          consignors={consignors}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setItem(saved);
            setActivePhoto(0);
            setEditing(false);
          }}
          onDeleted={() => {
            window.location.href = "/inventory";
          }}
          onConsignorAdded={(c) => setConsignors((prev) => [...prev, c])}
        />
      )}
    </AppShell>
  );
}
