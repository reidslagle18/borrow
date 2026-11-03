"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtShort } from "@/lib/dates";
import { statusLabel, type ItemStatus } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Global search (⌘K / "/"): pieces, customers, consignors at once.    */
/* ------------------------------------------------------------------ */

type SearchResults = {
  pieces: { id: string; barcode: string | null; label: string; size: string; status: string; photo_url: string | null }[];
  customers: { id: number; name: string; phone: string | null; email: string | null }[];
  consignors: { id: number; name: string; phone: string | null; email: string | null }[];
};

const EMPTY: SearchResults = { pieces: [], customers: [], consignors: [] };

export function GlobalSearch({
  variant,
}: {
  variant: "sidebar" | "topbar" | "inline";
}) {
  const inline = variant === "inline";
  const [open, setOpen] = useState(inline);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0); // highlighted row for arrow-key nav
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Flat list (pieces → customers → consignors) so the arrow keys can move
  // across groups and Enter opens the highlighted row.
  const flat: { href: string }[] = [
    ...results.pieces.map((p) => ({
      href: `/lookup?code=${encodeURIComponent(p.barcode || p.id)}`,
    })),
    ...results.customers.map((c) => ({ href: `/customers?open=${c.id}` })),
    ...results.consignors.map((c) => ({ href: `/consignors?open=${c.id}` })),
  ];

  // ⌘K / Ctrl+K anywhere; "/" when not typing in a field. (Modal variants only.)
  useEffect(() => {
    if (inline) return;
    function onKey(e: KeyboardEvent) {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(
        (e.target as HTMLElement)?.tagName ?? ""
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !inField) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inline]);

  useEffect(() => {
    if (inline) return;
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else {
      setQ("");
      setResults(EMPTY);
    }
  }, [open, inline]);

  // Debounced search — pieces show from the very first character.
  useEffect(() => {
    if ((!open && !inline) || q.trim().length < 1) {
      setResults(EMPTY);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          setResults(await res.json());
          setHi(0);
        }
      } catch {
        /* leave prior results */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open, inline]);

  const go = useCallback(
    (href: string) => {
      if (!inline) setOpen(false);
      setQ("");
      setResults(EMPTY);
      router.push(href);
    },
    [router, inline]
  );

  const total =
    results.pieces.length + results.customers.length + results.consignors.length;

  // Arrow keys move the highlight; Enter opens it (a barcode scan ends in Enter,
  // and the best match is highlighted first, so a scan jumps straight to it).
  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = flat[hi] ?? flat[0];
      if (sel) go(sel.href);
    } else if (e.key === "Escape" && !inline) {
      setOpen(false);
    }
  }

  const resultsBody =
    q.trim().length < 1 ? (
      inline ? null : (
        <p className="px-3 py-6 text-center text-[13px] text-ink/40">
          Type to search — barcode, brand, color, customer, or consignor.
        </p>
      )
    ) : loading && total === 0 ? (
      <p className="px-3 py-6 text-center text-[13px] text-ink/40">Searching…</p>
    ) : total === 0 ? (
      <p className="px-3 py-6 text-center text-[13px] text-ink/40">
        Nothing matches “{q.trim()}”.
      </p>
    ) : (
      <div className="max-h-[55vh] overflow-y-auto p-2">
        {results.pieces.length > 0 && (
          <Group label="Pieces">
            {results.pieces.map((p, i) => (
              <ResultRow
                key={p.id}
                active={i === hi}
                onClick={() =>
                  go(`/lookup?code=${encodeURIComponent(p.barcode || p.id)}`)
                }
              >
                <span className="flex h-9 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-lavender/40">
                  {p.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-serif italic text-ink/30">
                      {p.label.charAt(0)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{p.label}</span>
                  <span className="block truncate font-mono text-[12px] text-ink/45">
                    {p.barcode || p.id}
                  </span>
                </span>
                <StatusChip status={p.status} />
              </ResultRow>
            ))}
          </Group>
        )}
        {results.customers.length > 0 && (
          <Group label="Customers">
            {results.customers.map((c, i) => (
              <ResultRow
                key={c.id}
                active={results.pieces.length + i === hi}
                onClick={() => go(`/customers?open=${c.id}`)}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-[12px] text-ink/40">
                  {c.phone || c.email || ""}
                </span>
              </ResultRow>
            ))}
          </Group>
        )}
        {results.consignors.length > 0 && (
          <Group label="Consignors">
            {results.consignors.map((c, i) => (
              <ResultRow
                key={c.id}
                active={
                  results.pieces.length + results.customers.length + i === hi
                }
                onClick={() => go(`/consignors?open=${c.id}`)}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-[12px] text-ink/40">
                  {c.phone || c.email || ""}
                </span>
              </ResultRow>
            ))}
          </Group>
        )}
      </div>
    );

  // Always-visible inline box (top of Inventory).
  if (inline) {
    return (
      <div>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKey}
          inputMode="search"
          placeholder="Look up a piece — scan or type a barcode, or search…"
          className="w-full rounded-full border border-ink/15 bg-white px-5 py-3 text-base outline-none focus:border-ink/40"
        />
        {q.trim().length >= 1 && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-ink/10 bg-cream">
            {resultsBody}
          </div>
        )}
      </div>
    );
  }

  // Modal (sidebar / topbar triggers).
  return (
    <>
      {variant === "sidebar" ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-6 flex w-full items-center justify-between rounded-full border border-ink/15 bg-white px-4 py-2.5 text-[14px] text-ink/45 transition-colors hover:border-ink/35"
        >
          Search…
          <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[11px] text-ink/40">
            ⌘K
          </span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Search"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-white text-ink/60"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 p-4 pt-[12vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-cream shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search — barcode, brand, color, customer, consignor…"
              className="w-full border-b border-ink/10 bg-transparent px-5 py-4 text-base outline-none"
            />
            {resultsBody}
          </div>
        </div>
      )}
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-[0.18em] text-ink/40">
        {label}
      </p>
      {children}
    </div>
  );
}

function ResultRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] ${
        active ? "bg-ink/10" : "hover:bg-ink/5"
      }`}
    >
      {children}
    </button>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 text-[11px] text-ink/55">
      {statusLabel(status as ItemStatus)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications bell: everything needing attention, one place.        */
/* ------------------------------------------------------------------ */

type Notifications = {
  count: number;
  errors?: string[];
  disputed: { id: string; label: string; replacement_value: number | string | null; disputed_value: number | string | null; consignor_id: number; consignor_name: string }[];
  pending_approvals: { id: number; name: string; n: number }[];
  failed_charges: { id: number; amount: number | string; kind: string; customer_id: number | null; customer_name: string | null; item_label: string | null }[];
  overdue: { id: number; customer_name: string | null; item_label: string; days_late: number }[];
  overdue_reserved: { id: number; item_id: string; barcode: string | null; item_label: string; renter_name: string | null; next_customer: string | null; reservation_date: string; days_late: number }[];
  pull_soon: { rental_id: number; item_id: string; barcode: string | null; item_label: string; customer_name: string | null; reservation_date: string; last_safe_date: string; days_remaining: number }[];
  deferred_payouts: { id: number; amount: number | string; consignor_id: number; consignor_name: string }[];
  sizes_out: { size: string; total: number }[];
  retrievals: { id: number; consignor_id: number; consignor_name: string; item_id: string; barcode: string | null; item_status: string; item_label: string; note: string | null; hold_start: string | null; hold_end: string | null; conflict: boolean }[];
  underperformers: { id: string; barcode: string | null; item_label: string; consignor_id: number; consignor_name: string; has_email: boolean }[];
  unclaimed_storage: { id: string; barcode: string | null; item_label: string; consignor_id: number; consignor_name: string; storage_started_at: string }[];
  no_shows: { id: number; item_id: string; due_date: string; days_past_due: number; customer_name: string | null; item_label: string; ownership: string }[];
};

export function NotificationsBell({ variant }: { variant: "sidebar" | "topbar" }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Notifications | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actMsg, setActMsg] = useState("");
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) setData(await res.json());
    } catch {
      /* badge just stays as-is */
    }
  }, []);

  // Owner action on an item straight from the feed (approve/dismiss/acknowledge),
  // then refresh so the entry clears.
  const act = useCallback(
    async (
      itemId: string,
      action: string,
      confirmMsg?: string,
      extra?: Record<string, unknown>
    ) => {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setBusyId(itemId + action);
      setActMsg("");
      try {
        const res = await fetch(`/api/items/${encodeURIComponent(itemId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...(extra || {}) }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setActMsg(d.error || "Couldn't complete that — try again.");
        } else if (action === "approve_pickup_notice") {
          setActMsg("Pickup notice sent — 30-day clock started.");
        }
        await load();
      } catch {
        setActMsg("Couldn't reach the studio — try again.");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000); // refresh every 2 min
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const count = data?.count ?? 0;

  const bellIcon = (
    <span className="relative inline-flex">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-blush-deep px-1 text-[10px] font-semibold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </span>
  );

  return (
    <>
      {variant === "sidebar" ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 flex w-full items-center justify-between rounded-full border border-ink/15 bg-white px-4 py-2.5 text-[14px] text-ink/60 transition-colors hover:border-ink/35"
        >
          Needs attention
          {bellIcon}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Notifications"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 bg-white text-ink/60"
        >
          {bellIcon}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 p-4 pt-[10vh]"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-cream shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ink/10 px-5 py-3.5">
              <p className="font-serif text-xl font-medium">Needs attention</p>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full px-2 text-xl leading-none text-ink/40 hover:bg-ink/5"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              {data?.errors && data.errors.length > 0 && (
                <p className="mb-2 rounded-lg bg-blush-deep/15 px-3 py-2 text-[12px] text-blush-deep">
                  Some checks couldn&apos;t run this refresh ({data.errors.join(", ")}). Reopen in a moment to retry.
                </p>
              )}
              {!data ? (
                <p className="px-3 py-6 text-center text-[13px] text-ink/40">Loading…</p>
              ) : count === 0 ? (
                <p className="px-3 py-8 text-center text-[14px] text-ink/45">
                  All clear — nothing needs you right now. ✨
                </p>
              ) : (
                <div className="space-y-3">
                  {data.overdue_reserved.length > 0 && (
                    <NoteGroup label="⚠ Overdue AND reserved — act now" tone="bg-blush-deep/20">
                      {data.overdue_reserved.map((o) => (
                        <NoteRow
                          key={o.id}
                          onClick={() => go("/returns")}
                          text={`${o.item_label} is overdue and reserved by ${o.next_customer ?? "the next customer"} for ${o.reservation_date} — may need to contact them.`}
                        />
                      ))}
                    </NoteGroup>
                  )}
                  {data.retrievals.length > 0 && (
                    <NoteGroup label="Consignor holds" tone="bg-blush-deep/20">
                      {data.retrievals.map((r) => {
                        const onHold = r.item_status === "consignor_hold";
                        const rangeTxt = r.hold_start
                          ? r.hold_end && r.hold_end !== r.hold_start
                            ? `${fmtShort(r.hold_start)} – ${fmtShort(r.hold_end)}`
                            : fmtShort(r.hold_start)
                          : "ASAP";
                        return (
                          <div key={r.id} className="rounded-lg bg-white px-3 py-2">
                            {r.conflict && (
                              <p className="mb-1 rounded bg-blush-deep/20 px-2 py-1 text-[11px] font-medium text-blush-deep">
                                ⚠ Conflicts with a paying reservation for these dates — sort this out.
                              </p>
                            )}
                            <button
                              onClick={() => go(`/inventory/${encodeURIComponent(r.barcode || r.item_id)}`)}
                              className="block w-full text-left text-[13px] leading-snug"
                            >
                              {r.consignor_name} has {r.item_label} on hold · {rangeTxt}
                              {r.note ? ` — "${r.note}"` : ""}
                            </button>
                            {onHold ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  onClick={() =>
                                    act(
                                      r.item_id,
                                      "hold_return",
                                      `Mark ${r.item_label} returned clean and back on the rack?`,
                                      { needs_cleaning: false }
                                    )
                                  }
                                  disabled={busyId === r.item_id + "hold_return"}
                                  className="rounded-full bg-ink px-3 py-1.5 text-[12px] text-cream disabled:opacity-40"
                                >
                                  {busyId === r.item_id + "hold_return" ? "…" : "Returned clean"}
                                </button>
                                <button
                                  onClick={() =>
                                    act(
                                      r.item_id,
                                      "hold_return",
                                      `Mark ${r.item_label} returned and send to cleaning? The cleaning fee is deducted from ${r.consignor_name}'s earnings.`,
                                      { needs_cleaning: true }
                                    )
                                  }
                                  disabled={busyId === r.item_id + "hold_return"}
                                  className="rounded-full border border-ink/20 px-3 py-1.5 text-[12px] text-ink/60 disabled:opacity-40"
                                >
                                  {busyId === r.item_id + "hold_return" ? "…" : "Returned needs cleaning"}
                                </button>
                              </div>
                    ) : (
                              <p className="mt-1 text-[11px] text-ink/50">
                                Hold starts {rangeTxt} — pull it into the holding area soon.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </NoteGroup>
                  )}
                  {data.pull_soon && data.pull_soon.length > 0 && (
                    <NoteGroup label="Pull for reservation" tone="bg-butter/50">
                      {data.pull_soon.map((p) => (
                        <button
                          key={p.rental_id}
                          onClick={() => go(`/inventory/${encodeURIComponent(p.barcode || p.item_id)}`)}
                          className="block w-full rounded-lg bg-white px-3 py-2 text-left text-[13px] leading-snug"
                        >
                          {p.item_label} reserved {fmtShort(p.reservation_date)}
                          {p.customer_name ? ` · ${p.customer_name}` : ""} —{" "}
                          {p.days_remaining <= 0
                            ? "pull now"
                            : `pull within ${p.days_remaining} day${p.days_remaining === 1 ? "" : "s"}`}
                        </button>
                      ))}
                    </NoteGroup>
                  )}
                  {data.underperformers.length > 0 && (
                    <NoteGroup label="Underperforming — send pickup notice?" tone="bg-butter/50">
                      {data.underperformers.map((u) => (
                        <div key={u.id} className="rounded-lg bg-white px-3 py-2">
                          <button
                            onClick={() => go(`/inventory/${encodeURIComponent(u.barcode || u.id)}`)}
                            className="block w-full text-left text-[13px] leading-snug"
                          >
                            {u.item_label} ({u.consignor_name}) is underperforming
                          </button>
                          {!u.has_email && (
                            <p className="mt-1 text-[11px] text-blush-deep">
                              No email on file — add one to send a notice.
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() =>
                                act(
                                  u.id,
                                  "approve_pickup_notice",
                                  `Send ${u.consignor_name} a 30-day pickup notice for ${u.item_label}?`
                                )
                              }
                              disabled={!u.has_email || busyId === u.id + "approve_pickup_notice"}
                              className="rounded-full bg-ink px-3 py-1.5 text-[12px] text-cream disabled:opacity-40"
                            >
                              {busyId === u.id + "approve_pickup_notice" ? "Sending…" : "Approve & Send"}
                            </button>
                            <button
                              onClick={() => act(u.id, "dismiss_underperformance")}
                              disabled={busyId === u.id + "dismiss_underperformance"}
                              className="rounded-full border border-ink/20 px-3 py-1.5 text-[12px] text-ink/60 disabled:opacity-40"
                            >
                              {busyId === u.id + "dismiss_underperformance" ? "…" : "Dismiss"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </NoteGroup>
                  )}
                  {data.unclaimed_storage.length > 0 && (
                    <NoteGroup label="Unclaimed after storage — decide next step" tone="bg-blush/40">
                      {data.unclaimed_storage.map((u) => (
                        <div key={u.id} className="rounded-lg bg-white px-3 py-2">
                          <button
                            onClick={() => go(`/inventory/${encodeURIComponent(u.barcode || u.id)}`)}
                            className="block w-full text-left text-[13px] leading-snug"
                          >
                            {u.item_label} ({u.consignor_name}) is unclaimed after the
                            full storage period
                          </button>
                          <button
                            onClick={() => act(u.id, "acknowledge_unclaimed")}
                            disabled={busyId === u.id + "acknowledge_unclaimed"}
                            className="mt-2 rounded-full border border-ink/20 px-3 py-1.5 text-[12px] text-ink/60 disabled:opacity-40"
                          >
                            {busyId === u.id + "acknowledge_unclaimed" ? "…" : "Acknowledge"}
                          </button>
                        </div>
                      ))}
                    </NoteGroup>
                  )}
                  {actMsg && (
                    <p className="px-1 text-[12px] text-ink/55">{actMsg}</p>
                  )}
                  {data.disputed.length > 0 && (
                    <NoteGroup label="Disputed replacement values" tone="bg-blush/40">
                      {data.disputed.map((d) => (
                        <NoteRow
                          key={d.id}
                          onClick={() => go(`/consignors?open=${d.consignor_id}`)}
                          text={`${d.label} — ${d.consignor_name} suggests $${Number(d.disputed_value ?? 0)} (yours: $${Number(d.replacement_value ?? 0)})`}
                        />
                      ))}
                    </NoteGroup>
                  )}
                  {data.overdue.length > 0 && (
                    <NoteGroup label="Overdue returns" tone="bg-butter/60">
                      {data.overdue.map((o) => (
                        <NoteRow
                          key={o.id}
                          onClick={() => go("/returns")}
                          text={`${o.item_label} — ${o.customer_name ?? "renter"} · ${o.days_late} day${o.days_late === 1 ? "" : "s"} late`}
                        />
                      ))}
                    </NoteGroup>
                  )}
                  {data.pending_approvals.length > 0 && (
                    <NoteGroup label="Awaiting consignor approval" tone="bg-butter/40">
                      {data.pending_approvals.map((p) => (
                        <NoteRow
                          key={p.id}
                          onClick={() => go(`/consignors?open=${p.id}`)}
                          text={`${p.name} — ${p.n} item${p.n === 1 ? "" : "s"} to approve`}
                        />
                      ))}
                    </NoteGroup>
                  )}
                  {data.deferred_payouts.length > 0 && (
                    <NoteGroup label="Payouts waiting on funds" tone="bg-lavender/40">
                      {data.deferred_payouts.map((p) => (
                        <NoteRow
                          key={p.id}
                          onClick={() => go(`/consignors?open=${p.consignor_id}`)}
                          text={`$${Number(p.amount)} to ${p.consignor_name} — retrying automatically`}
                        />
                      ))}
                    </NoteGroup>
                  )}
                  {data.sizes_out.length > 0 && (
                    <NoteGroup label="Sizes fully rented out" tone="bg-sage/40">
                      {data.sizes_out.map((s) => (
                        <NoteRow
                          key={s.size}
                          onClick={() => go("/inventory")}
                          text={`Size ${s.size} — all ${s.total} pieces are out`}
                        />
                      ))}
                    </NoteGroup>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NoteGroup({
  label,
  tone,
  children,
}: {
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl ${tone} p-3`}>
      <p className="px-1 pb-1 text-[11px] uppercase tracking-[0.18em] text-ink/50">
        {label}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NoteRow({ onClick, text }: { onClick: () => void; text: string }) {
  return (
    <button
      onClick={onClick}
      className="block w-full rounded-xl bg-white/80 px-3 py-2 text-left text-[13px] leading-snug hover:bg-white"
    >
      {text}
    </button>
  );
}
