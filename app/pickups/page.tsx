"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";

type Awaiting = {
  id: string;
  barcode: string | null;
  item_label: string;
  photo: string | null;
  consignor_id: number;
  consignor_name: string;
  pickup_notice_sent_at: string;
  days_remaining: number;
};
type Stored = {
  id: string;
  barcode: string | null;
  item_label: string;
  photo: string | null;
  consignor_id: number;
  consignor_name: string;
  storage_started_at: string;
  days_remaining: number;
};
type Under = {
  id: string;
  barcode: string | null;
  item_label: string;
  photo: string | null;
  consignor_id: number;
  consignor_name: string;
  has_email: boolean;
};
type Unclaimed = {
  id: string;
  barcode: string | null;
  item_label: string;
  photo: string | null;
  consignor_name: string;
};

function fmt(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString();
}
function daysLabel(n: number): string {
  if (n <= 0) return "due now";
  return `${n} day${n === 1 ? "" : "s"} left`;
}

export default function PickupsPage() {
  const [pickups, setPickups] = useState<{ awaiting_pickup: Awaiting[]; in_storage: Stored[] } | null>(null);
  const [under, setUnder] = useState<Under[]>([]);
  const [unclaimed, setUnclaimed] = useState<Unclaimed[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingBatch, setSendingBatch] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, n] = await Promise.all([
        fetch("/api/pickups"),
        fetch("/api/notifications"),
      ]);
      if (!p.ok) throw new Error("pickups");
      setPickups(await p.json());
      if (n.ok) {
        const nd = await n.json();
        setUnder(nd.underperformers ?? []);
        setUnclaimed(nd.unclaimed_storage ?? []);
      }
    } catch {
      setLoadError("Couldn't load pickups — refresh to try again.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (itemId: string, action: string, confirmMsg?: string) => {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setBusyId(itemId + action);
      setMsg("");
      try {
        const res = await fetch(`/api/items/${encodeURIComponent(itemId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) setMsg(d.error || "Couldn't complete that — try again.");
        else if (action === "approve_pickup_notice") setMsg("Pickup notice sent — 30-day clock started.");
        else if (action === "return_to_consignor") setMsg("Marked as picked up — returned to the consignor.");
        await load();
      } catch {
        setMsg("Couldn't reach the studio — try again.");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Send ONE pickup email per consignor for all selected underperforming pieces,
  // then start each piece's 30-day clock (moves them to "Awaiting pickup").
  const sendBatch = useCallback(async () => {
    const ids = under.filter((u) => selected.has(u.id) && u.has_email).map((u) => u.id);
    if (ids.length === 0) return;
    const people = new Set(
      under.filter((u) => ids.includes(u.id)).map((u) => u.consignor_id)
    ).size;
    const who =
      people === 1
        ? under.find((u) => ids.includes(u.id))!.consignor_name
        : `${people} consignors`;
    if (
      !window.confirm(
        `Send a pickup email to ${who} for ${ids.length} piece${ids.length === 1 ? "" : "s"}? This starts the 30-day pickup clock on each.`
      )
    )
      return;
    setSendingBatch(true);
    setMsg("");
    try {
      const res = await fetch("/api/pickups/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_ids: ids }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(d.error || "Couldn't send — try again.");
      } else {
        const total = (d.sent ?? []).reduce(
          (n: number, s: { count: number }) => n + s.count,
          0
        );
        const emails = (d.sent ?? []).length;
        let m = `Sent ${emails} email${emails === 1 ? "" : "s"} covering ${total} piece${total === 1 ? "" : "s"}.`;
        if ((d.skipped ?? []).length > 0) {
          m += ` Skipped ${d.skipped.length} (no email / failed).`;
        }
        setMsg(m);
        setSelected(new Set());
      }
      await load();
    } catch {
      setMsg("Couldn't reach the studio — try again.");
    } finally {
      setSendingBatch(false);
    }
  }, [under, selected, load]);

  const selectableUnder = under.filter((u) => u.has_email);
  const selectedCount = under.filter((u) => selected.has(u.id) && u.has_email).length;

  const Row = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/70 p-3">
      {children}
    </div>
  );

  // Dress thumbnail shown beside each piece so pieces are recognizable at a glance.
  const Thumb = ({ src, alt }: { src: string | null; alt: string }) => (
    <span className="relative block h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-ink/30">
          No photo
        </span>
      )}
    </span>
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Storage & Pickups</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Underperforming pieces, active pickup deadlines, and stored pieces.
        </p>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !pickups ? (
          <div className="mt-8 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            {msg && <p className="mt-4 text-sm text-ink/60">{msg}</p>}

            {/* Underperforming — awaiting your approval */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Underperforming — your approval{" "}
                <span className="text-ink/40">({under.length})</span>
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Nothing is emailed until you approve. Tick the pieces you want
                picked up to send one email per consignor, or use a row&apos;s own
                button. &quot;Dismiss&quot; gives a piece more time.
              </p>

              {selectableUnder.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-butter/60 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        selectedCount === selectableUnder.length
                          ? new Set()
                          : new Set(selectableUnder.map((u) => u.id))
                      )
                    }
                    className="text-[13px] font-medium underline-offset-2 hover:underline"
                  >
                    {selectedCount === selectableUnder.length ? "Clear all" : "Select all"}
                  </button>
                  <span className="text-[13px] text-ink/50">
                    {selectedCount} selected
                  </span>
                  <button
                    type="button"
                    onClick={sendBatch}
                    disabled={selectedCount === 0 || sendingBatch}
                    className="ml-auto rounded-full bg-ink px-5 py-2 text-[13px] text-cream disabled:opacity-40"
                  >
                    {sendingBatch
                      ? "Sending…"
                      : `Send pickup email${selectedCount > 1 ? "s" : ""}`}
                  </button>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {under.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    No pieces flagged right now.
                  </p>
                ) : (
                  under.map((u) => (
                    <Row key={u.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        disabled={!u.has_email}
                        onChange={() => toggle(u.id)}
                        aria-label={`Select ${u.item_label}`}
                        title={u.has_email ? "Select to email" : "No email on file"}
                        className="h-5 w-5 shrink-0 accent-ink disabled:opacity-30"
                      />
                      <Link
                        href={`/inventory/${u.barcode || u.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 text-[15px] hover:underline"
                      >
                        <Thumb src={u.photo} alt={u.item_label} />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{u.item_label}</span>{" "}
                          <span className="text-ink/50">· {u.consignor_name}</span>
                          {!u.has_email && (
                            <span className="text-blush-deep"> · no email on file</span>
                          )}
                        </span>
                      </Link>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            act(
                              u.id,
                              "approve_pickup_notice",
                              `Send ${u.consignor_name} a 30-day pickup notice for ${u.item_label}?`
                            )
                          }
                          disabled={!u.has_email || busyId === u.id + "approve_pickup_notice"}
                          className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40"
                        >
                          {busyId === u.id + "approve_pickup_notice" ? "Sending…" : "Approve & Send"}
                        </button>
                        <button
                          onClick={() => act(u.id, "dismiss_underperformance")}
                          disabled={busyId === u.id + "dismiss_underperformance"}
                          className="rounded-full border border-ink/20 px-4 py-2 text-[13px] text-ink/60 disabled:opacity-40"
                        >
                          Dismiss
                        </button>
                      </div>
                    </Row>
                  ))
                )}
              </div>
            </section>

            {/* Awaiting Pickup */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Awaiting pickup{" "}
                <span className="text-ink/40">({pickups.awaiting_pickup.length})</span>
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Notice sent; 30 days to collect before it moves to storage.
              </p>
              <div className="mt-3 space-y-2">
                {pickups.awaiting_pickup.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    Nothing awaiting pickup.
                  </p>
                ) : (
                  pickups.awaiting_pickup.map((a) => (
                    <Row key={a.id}>
                      <Link
                        href={`/inventory/${a.barcode || a.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 text-[15px] hover:underline"
                      >
                        <Thumb src={a.photo} alt={a.item_label} />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{a.item_label}</span>{" "}
                          <span className="text-ink/50">
                            · {a.consignor_name} · notice sent {fmt(a.pickup_notice_sent_at)}
                          </span>
                        </span>
                      </Link>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[12px] ${
                            a.days_remaining <= 5 ? "bg-blush-deep text-cream" : "bg-butter"
                          }`}
                        >
                          {daysLabel(a.days_remaining)}
                        </span>
                        <button
                          onClick={() =>
                            act(
                              a.id,
                              "return_to_consignor",
                              `Mark "${a.item_label}" as picked up by ${a.consignor_name}? This returns the piece to them and clears it from the rack.`
                            )
                          }
                          disabled={busyId === a.id + "return_to_consignor"}
                          className="rounded-full bg-ink px-3.5 py-2 text-[12px] text-cream disabled:opacity-40"
                        >
                          {busyId === a.id + "return_to_consignor" ? "Saving…" : "✓ Picked up"}
                        </button>
                      </div>
                    </Row>
                  ))
                )}
              </div>
            </section>

            {/* In Storage */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                In storage{" "}
                <span className="text-ink/40">({pickups.in_storage.length})</span>
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Not rentable; still retrievable until the storage window ends.
              </p>
              <div className="mt-3 space-y-2">
                {pickups.in_storage.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    Nothing in storage.
                  </p>
                ) : (
                  pickups.in_storage.map((s) => (
                    <Row key={s.id}>
                      <Link
                        href={`/inventory/${s.barcode || s.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 text-[15px] hover:underline"
                      >
                        <Thumb src={s.photo} alt={s.item_label} />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{s.item_label}</span>{" "}
                          <span className="text-ink/50">
                            · {s.consignor_name} · stored {fmt(s.storage_started_at)}
                          </span>
                        </span>
                      </Link>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] ${
                          s.days_remaining <= 0 ? "bg-blush-deep text-cream" : "bg-lavender"
                        }`}
                      >
                        {daysLabel(s.days_remaining)}
                      </span>
                    </Row>
                  ))
                )}
              </div>
            </section>

            {/* Unclaimed — your final decision */}
            {unclaimed.length > 0 && (
              <section className="mt-8">
                <h2 className="text-2xl font-medium">
                  Unclaimed — your decision{" "}
                  <span className="text-ink/40">({unclaimed.length})</span>
                </h2>
                <p className="mt-1 text-[13px] text-ink/50">
                  Storage window ended. Nothing is auto-disposed — decide off-system
                  (contact, donate, claim), then acknowledge to clear.
                </p>
                <div className="mt-3 space-y-2">
                  {unclaimed.map((u) => (
                    <Row key={u.id}>
                      <Link
                        href={`/inventory/${u.barcode || u.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 text-[15px] hover:underline"
                      >
                        <Thumb src={u.photo} alt={u.item_label} />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{u.item_label}</span>{" "}
                          <span className="text-ink/50">· {u.consignor_name}</span>
                        </span>
                      </Link>
                      <button
                        onClick={() => act(u.id, "acknowledge_unclaimed")}
                        disabled={busyId === u.id + "acknowledge_unclaimed"}
                        className="rounded-full border border-ink/20 px-4 py-2 text-[13px] text-ink/60 disabled:opacity-40"
                      >
                        Acknowledge
                      </button>
                    </Row>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
