"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { tierLabel, Tier } from "@/lib/types";

type Rental = {
  id: number;
  item_id: string;
  barcode: string | null;
  brand: string;
  size: string;
  tier: Tier;
  photo_url: string | null;
  customer_name: string | null;
  due_date: string;
};
type Dropoff = {
  id: number;
  slot_time: string;
  name: string;
  phone: string | null;
  item_count: number;
  consignor_id: number | null;
};
type Today = {
  pickups: Rental[];
  returns_today: Rental[];
  overdue: Rental[];
  dropoffs: Dropoff[];
};

function prettyTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function Thumb({ url, brand }: { url: string | null; brand: string }) {
  return (
    <div className="h-12 w-9 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
          {brand.charAt(0)}
        </div>
      )}
    </div>
  );
}

export default function TodayPage() {
  const [data, setData] = useState<Today | null>(null);

  useEffect(() => {
    fetch("/api/today")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData({ pickups: [], returns_today: [], overdue: [], dropoffs: [] }));
  }, []);

  function RentalRow({ r, overdue }: { r: Rental; overdue?: boolean }) {
    return (
      <Link
        href={`/inventory/${r.barcode || r.item_id}`}
        className={`flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white ${
          overdue ? "bg-blush/25" : "bg-white/70"
        }`}
      >
        <Thumb url={r.photo_url} brand={r.brand} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]">
            <span className="font-medium">{r.customer_name ?? "No customer"}</span>{" "}
            <span className="text-ink/50">· {r.brand}</span>
          </p>
          <p className="truncate text-[13px] text-ink/55">
            {r.barcode || r.item_id} · {r.size} · {tierLabel(r.tier)}
          </p>
        </div>
        {overdue && (
          <span className="shrink-0 rounded-full bg-blush-deep px-2.5 py-1 text-[11px] text-cream">
            overdue
          </span>
        )}
      </Link>
    );
  }

  const pickups = data?.pickups ?? [];
  const returns = data?.returns_today ?? [];
  const overdue = data?.overdue ?? [];
  const dropoffs = data?.dropoffs ?? [];
  const returnsCount = returns.length + overdue.length;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Today</h1>
        <p className="mt-1.5 text-sm text-ink/50">{todayLabel()}</p>

        {!data ? (
          <div className="mt-8 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            <p className="mt-4 rounded-2xl bg-lavender/30 px-4 py-3 text-[15px]">
              <span className="font-medium">{pickups.length}</span> pickup
              {pickups.length === 1 ? "" : "s"} ·{" "}
              <span className="font-medium">{returnsCount}</span> return
              {returnsCount === 1 ? "" : "s"}
              {overdue.length > 0 && (
                <span className="text-blush-deep"> ({overdue.length} overdue)</span>
              )}{" "}
              · <span className="font-medium">{dropoffs.length}</span> drop-off
              {dropoffs.length === 1 ? "" : "s"}
            </p>

            {/* Pickups */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Pickups today <span className="text-ink/40">({pickups.length})</span>
              </h2>
              <div className="mt-3 space-y-2">
                {pickups.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    No pickups scheduled today.
                  </p>
                ) : (
                  pickups.map((r) => <RentalRow key={r.id} r={r} />)
                )}
              </div>
            </section>

            {/* Returns due */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Returns due today{" "}
                <span className="text-ink/40">({returnsCount})</span>
              </h2>
              <div className="mt-3 space-y-2">
                {overdue.map((r) => (
                  <RentalRow key={r.id} r={r} overdue />
                ))}
                {returns.map((r) => (
                  <RentalRow key={r.id} r={r} />
                ))}
                {returnsCount === 0 && (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    Nothing due back today.
                  </p>
                )}
              </div>
            </section>

            {/* Drop-offs */}
            <section className="mt-8">
              <h2 className="text-2xl font-medium">
                Drop-off appointments today{" "}
                <span className="text-ink/40">({dropoffs.length})</span>
              </h2>
              <div className="mt-3 space-y-2">
                {dropoffs.length === 0 ? (
                  <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink/45">
                    No drop-offs booked today.
                  </p>
                ) : (
                  dropoffs.map((a) => (
                    <Link
                      key={a.id}
                      href="/dropoff"
                      className="flex items-center gap-3 rounded-2xl bg-white/70 p-3 transition-colors hover:bg-white"
                    >
                      <span className="w-20 shrink-0 text-center font-serif text-lg font-semibold">
                        {prettyTime(a.slot_time)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">
                          {a.name}{" "}
                          <span className="text-ink/50">
                            · {a.item_count} item{a.item_count === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="truncate text-[13px] text-ink/55">
                          {a.phone || "no phone"}
                        </p>
                      </div>
                    </Link>
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
