"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { fmtShort, dateOnly } from "@/lib/dates";

type Pull = {
  rental_id: number | null;
  request_id: number | null;
  kind: "rental" | "consignor";
  note: string | null;
  id: string;
  barcode: string | null;
  item_label: string;
  photo_url: string | null;
  status: string;
  reservation_date: string;
  customer_name: string | null;
  last_safe_date: string;
  days_remaining: number;
  pulled: boolean;
};

const keyOf = (p: Pull) => `${p.kind}-${p.rental_id ?? p.request_id}`;

function Badge({ days }: { days: number }) {
  if (days <= 0) {
    return (
      <span className="shrink-0 rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">
        Pull now
      </span>
    );
  }
  const soon = days <= 3;
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${
        soon ? "bg-butter-deep/70 text-ink" : "bg-ink/10 text-ink/60"
      }`}
    >
      {days} day{days === 1 ? "" : "s"} left
    </span>
  );
}

function Thumb({ url, label }: { url: string | null; label: string }) {
  return (
    <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
          {label.charAt(0)}
        </div>
      )}
    </div>
  );
}

function Row({
  p,
  busy,
  onPulled,
}: {
  p: Pull;
  busy: boolean;
  onPulled: (p: Pull, pulled: boolean) => void;
}) {
  const pull = p.days_remaining <= 0;
  const isConsignor = p.kind === "consignor";
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl p-3 ${
        pull ? "bg-blush/25" : "bg-white/70"
      }`}
    >
      <Link
        href={`/inventory/${p.barcode || p.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <Thumb url={p.photo_url} label={p.item_label} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-medium">{p.item_label}</p>
            {isConsignor && (
              <span className="shrink-0 rounded-full bg-lavender px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink/70">
                Consignor
              </span>
            )}
          </div>
          <p className="truncate text-[13px] text-ink/55">
            {isConsignor ? "Consignor wants it back" : "Reserved"}{" "}
            {fmtShort(dateOnly(p.reservation_date))}
            {p.customer_name ? ` · ${p.customer_name}` : ""}
          </p>
          {isConsignor && p.note ? (
            <p className="truncate text-[12px] italic text-ink/50">&ldquo;{p.note}&rdquo;</p>
          ) : (
            <p className="truncate text-[12px] text-ink/45">
              Last safe rental date {fmtShort(dateOnly(p.last_safe_date))}
            </p>
          )}
        </div>
      </Link>
      <Badge days={p.days_remaining} />
      <button
        onClick={() => onPulled(p, true)}
        disabled={busy}
        className="shrink-0 rounded-full bg-ink px-3.5 py-2 text-[13px] text-cream disabled:opacity-40"
      >
        {busy ? "…" : "Pulled"}
      </button>
    </div>
  );
}

export default function PullListPage() {
  const [rows, setRows] = useState<Pull[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pull-list");
      if (!res.ok) throw new Error();
      setRows(await res.json());
    } catch {
      setLoadError("Couldn't load the pull list.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markPulled(p: Pull, pulled: boolean) {
    const key = keyOf(p);
    setBusy(key);
    setRows((rs) => (rs ? rs.map((x) => (keyOf(x) === key ? { ...x, pulled } : x)) : rs));
    try {
      if (p.kind === "consignor") {
        await fetch(`/api/pull-list`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: p.request_id, pulled }),
        });
      } else {
        await fetch(`/api/rentals/${p.rental_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: pulled ? "pull" : "unpull" }),
        });
      }
      await load();
    } catch {
      await load();
    } finally {
      setBusy(null);
    }
  }

  const active = (rows ?? []).filter((p) => !p.pulled);
  const pullNow = active.filter((p) => p.days_remaining <= 0);
  const upcoming = active.filter((p) => p.days_remaining > 0);
  const donePulls = (rows ?? []).filter((p) => p.pulled);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Pull list</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Pieces to move from the browsable racks into the Reserved holding area.
          Tap Pulled once a piece is set aside so only new ones stay on the list.
        </p>

        {loadError && rows === null ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : rows === null ? (
          <div className="mt-8 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : active.length === 0 && donePulls.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white p-5 text-sm text-ink/45">
            Nothing to pull — no upcoming reservations or consignor holds.
          </p>
        ) : (
          <div className="mt-8 space-y-8">
            <section>
              <h2 className="mb-2 text-xl font-medium">
                Pull now <span className="text-ink/40">({pullNow.length})</span>
              </h2>
              {pullNow.length === 0 ? (
                <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                  Nothing needs pulling today.
                </p>
              ) : (
                <div className="space-y-2">
                  {pullNow.map((p) => (
                    <Row key={keyOf(p)} p={p} busy={busy === keyOf(p)} onPulled={markPulled} />
                  ))}
                </div>
              )}
            </section>

            {upcoming.length > 0 && (
              <section>
                <h2 className="mb-2 text-xl font-medium text-ink/60">
                  Coming up <span className="text-ink/40">({upcoming.length})</span>
                </h2>
                <div className="space-y-2">
                  {upcoming.map((p) => (
                    <Row key={keyOf(p)} p={p} busy={busy === keyOf(p)} onPulled={markPulled} />
                  ))}
                </div>
              </section>
            )}

            {donePulls.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[13px] text-ink/45">
                  Already pulled ({donePulls.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {donePulls.map((p) => (
                    <div
                      key={keyOf(p)}
                      className="flex items-center gap-3 rounded-2xl bg-white/40 p-3 text-ink/55"
                    >
                      <Thumb url={p.photo_url} label={p.item_label} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          {p.item_label}
                          {p.kind === "consignor" ? " · consignor" : ""}
                        </p>
                        <p className="truncate text-[13px] text-ink/45">
                          {p.kind === "consignor" ? "Wants it back" : "Reserved"}{" "}
                          {fmtShort(dateOnly(p.reservation_date))}
                          {p.customer_name ? ` · ${p.customer_name}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-sage px-2.5 py-1 text-[11px] text-ink">
                        Pulled ✓
                      </span>
                      <button
                        onClick={() => markPulled(p, false)}
                        disabled={busy === keyOf(p)}
                        className="shrink-0 text-[13px] text-ink/45 underline disabled:opacity-40"
                      >
                        {busy === keyOf(p) ? "…" : "Undo"}
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
