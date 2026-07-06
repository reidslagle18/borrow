"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { fmtShort, dateOnly } from "@/lib/dates";

type Appt = {
  id: number;
  slot_date: string;
  slot_time: string;
  name: string;
  phone: string | null;
  email: string | null;
  item_count: number;
  customer_id: number | null;
  consignor_id: number | null;
  customer_name: string | null;
  consignor_name: string | null;
};

function prettyTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export default function DropoffPage() {
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);

  async function load() {
    const res = await fetch("/api/dropoff");
    if (res.ok) setAppts(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function cancel(id: number) {
    const res = await fetch(`/api/dropoff/${id}`, { method: "DELETE" });
    if (res.ok) {
      setAppts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
      setConfirmCancel(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (appts ?? []).filter((a) => dateOnly(a.slot_date) >= today);
  const past = (appts ?? []).filter((a) => dateOnly(a.slot_date) < today);

  // Group upcoming by date for clean day headers.
  const byDate = new Map<string, Appt[]>();
  for (const a of upcoming) {
    const d = dateOnly(a.slot_date);
    const arr = byDate.get(d);
    if (arr) arr.push(a);
    else byDate.set(d, [a]);
  }

  function Row({ a }: { a: Appt }) {
    const linked = a.consignor_name
      ? `Consignor · ${a.consignor_name}`
      : a.customer_name
        ? `Customer · ${a.customer_name}`
        : "New to Borrow";
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5">
        <div className="w-20 shrink-0 text-center">
          <p className="font-serif text-lg font-semibold">{prettyTime(a.slot_time)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">
            {a.name}{" "}
            <span className="text-ink/50">
              · {a.item_count} item{a.item_count === 1 ? "" : "s"}
            </span>
          </p>
          <p className="truncate text-[13px] text-ink/55">
            {[a.phone, a.email].filter(Boolean).join(" · ") || "no contact"}
          </p>
          <p className="text-[12px] text-ink/45">{linked}</p>
        </div>
        {confirmCancel === a.id ? (
          <button
            onClick={() => cancel(a.id)}
            className="shrink-0 rounded-full border border-blush-deep px-3 py-1.5 text-[12px] text-blush-deep"
          >
            Cancel it?
          </button>
        ) : (
          <button
            onClick={() => setConfirmCancel(a.id)}
            className="shrink-0 rounded-full border border-ink/15 px-3 py-1.5 text-[12px] text-ink/50"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="text-4xl font-medium md:text-5xl">Drop-off appointments</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          {upcoming.length} upcoming · set hours &amp; closed days in Settings
        </p>

        {appts === null ? (
          <div className="mt-8 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <p className="mt-8 rounded-2xl bg-white p-5 text-sm text-ink/45">
            No upcoming drop-offs booked.
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            {Array.from(byDate.entries()).map(([d, list]) => (
              <section key={d}>
                <h2 className="mb-2 text-xl font-medium">{fmtShort(d)}</h2>
                <div className="space-y-2">
                  {list.map((a) => (
                    <Row key={a.id} a={a} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-medium text-ink/50">Past</h2>
            <div className="mt-2 space-y-2 opacity-60">
              {past.slice(0, 15).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-2xl bg-white/60 p-3 text-[13px]"
                >
                  <span className="w-28 shrink-0 text-ink/50">
                    {fmtShort(dateOnly(a.slot_date))} · {prettyTime(a.slot_time)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {a.name} · {a.item_count} item{a.item_count === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
