"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { fmtShort, dateOnly } from "@/lib/dates";

type Hold = {
  id: number;
  hold_start: string | null;
  hold_end: string | null;
  note: string | null;
  created_at: string;
  consignor_id: number;
  consignor_name: string;
  consignor_email: string | null;
  item_id: string;
  barcode: string;
  item_name: string;
  photo_url: string | null;
  item_status: string;
  active: boolean;
  past_end: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  available: "On the rack",
  reserved: "Reserved",
  rented: "Rented out",
  consignor_hold: "On hold",
  cleaning: "Being cleaned",
  with_consignor: "With consignor",
  in_storage: "In storage",
  retired: "Returned",
};

function range(r: Hold): string {
  if (!r.hold_start) return "ASAP";
  const start = fmtShort(dateOnly(r.hold_start));
  const end = r.hold_end ? fmtShort(dateOnly(r.hold_end)) : start;
  return `${start} – ${end}`;
}

function Row({ r, onChanged }: { r: Hold; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onHold = r.item_status === "consignor_hold";

  async function markReturned(needsCleaning: boolean) {
    const msg = needsCleaning
      ? `Mark ${r.item_name} returned and send it to cleaning? The cleaning fee will be deducted from ${r.consignor_name}'s earnings.`
      : `Mark ${r.item_name} returned clean and put it back on the rack?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/items/${r.item_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hold_return", needs_cleaning: needsCleaning }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || "Couldn't update — try again.");
        setBusy(false);
        return;
      }
      onChanged();
    } catch {
      setErr("Couldn't update — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-3">
      <div className="flex items-center gap-3">
        <Link href={`/inventory/${r.barcode}`} className="flex min-w-0 flex-1 items-center gap-3">
          {r.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="h-14 w-14 shrink-0 rounded-xl bg-ink/5" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{r.item_name}</p>
            <p className="truncate text-[13px] text-ink/55">
              {r.consignor_name} · {STATUS_LABEL[r.item_status] ?? r.item_status}
            </p>
            {r.note && <p className="mt-0.5 truncate text-[12px] text-ink/45">“{r.note}”</p>}
          </div>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full bg-blush-deep/25 px-2.5 py-1 text-[12px]">{range(r)}</span>
          {r.past_end ? (
            <span className="rounded-full bg-butter px-2 py-0.5 text-[11px]">past requested end</span>
          ) : r.active ? (
            <span className="text-[11px] text-ink/40">within range</span>
          ) : (
            <span className="text-[11px] text-ink/40">upcoming</span>
          )}
        </div>
      </div>
      {onHold && (
        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-ink/10 pt-2.5">
          <button
            onClick={() => markReturned(false)}
            disabled={busy}
            className="rounded-full bg-ink px-3.5 py-2 text-[13px] text-cream disabled:opacity-40"
          >
            {busy ? "Working…" : "Returned clean"}
          </button>
          <button
            onClick={() => markReturned(true)}
            disabled={busy}
            className="rounded-full border border-ink/15 px-3.5 py-2 text-[13px] text-ink/70 disabled:opacity-40"
          >
            Returned needs cleaning
          </button>
        </div>
      )}
      {err && <p className="mt-1.5 text-[12px] text-blush-deep">{err}</p>}
    </div>
  );
}

export default function ConsignorHoldsPage() {
  const [rows, setRows] = useState<Hold[] | null>(null);
  const [loadError, setLoadError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/retrievals");
      if (!res.ok) throw new Error();
      setRows(await res.json());
    } catch {
      setLoadError("Couldn't load consignor holds.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const active = (rows ?? []).filter((r) => r.active);
  const upcoming = (rows ?? []).filter((r) => !r.active);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Consignor Holds</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          {active.length} on hold now · {upcoming.length} upcoming · pieces consignors
          have asked back for a date range
        </p>

        {loadError && rows === null ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : rows === null ? (
          <div className="mt-8 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white p-5 text-sm text-ink/45">
            No consignor holds right now.
          </p>
        ) : (
          <div className="mt-8 space-y-8">
            {active.length > 0 && (
              <section>
                <h2 className="mb-2 text-xl font-medium">On hold now</h2>
                <div className="space-y-2">
                  {active.map((r) => (
                    <Row key={r.id} r={r} onChanged={load} />
                  ))}
                </div>
              </section>
            )}
            {upcoming.length > 0 && (
              <section>
                <h2 className="mb-2 text-xl font-medium">Upcoming</h2>
                <div className="space-y-2">
                  {upcoming.map((r) => (
                    <Row key={r.id} r={r} onChanged={load} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
