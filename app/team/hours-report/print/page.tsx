"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMe } from "@/lib/useMe";
import { fromISO, fmtShort } from "@/lib/dates";
import { fmtHoursMinutes, toHours } from "@/lib/timeclock-shared";

type MemberWeek = { week_start: string; minutes: number; over40: boolean };
type MemberRow = {
  id: number;
  name: string;
  per_day: Record<string, number>;
  total_minutes: number;
  weeks: MemberWeek[];
};
type Resp = {
  period: { start: string; end: string; label: string; closed: boolean };
  prev: string;
  next: string;
  days: string[];
  weeks: { start: string; end: string }[];
  members: MemberRow[];
};

function dayHeader(iso: string): string {
  return fromISO(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

function PrintReport() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const params = useSearchParams();
  const period = params.get("period") || "";
  const [data, setData] = useState<Resp | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/team/hours-report?period=${encodeURIComponent(period)}`
        );
        if (!res.ok) throw new Error(`hours-report ${res.status}`);
        setData(await res.json());
      } catch {
        setLoadError("Couldn't load the hours report.");
      }
    })();
  }, [isAdmin, period]);

  if (meLoading) {
    return <p className="text-ink/50">Loading…</p>;
  }
  if (!isAdmin) {
    return <p className="text-ink/50">Admins only.</p>;
  }
  if (loadError) {
    return <p className="text-ink/50">{loadError}</p>;
  }
  if (!data) {
    return <p className="text-ink/50">Loading…</p>;
  }

  return (
    <div className="text-black">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            BORROW — Hours ({data.period.label})
          </h1>
          <p className="mt-1 text-sm text-black/60">
            Exact clock in/out times — no rounding.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="print:hidden rounded-full border border-black/30 px-4 py-2 text-[13px]"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border border-black/40 px-2 py-1.5 text-left">
                Employee
              </th>
              {data.days.map((d) => (
                <th
                  key={d}
                  className="whitespace-nowrap border border-black/40 px-2 py-1.5 text-right"
                >
                  {dayHeader(d)}
                </th>
              ))}
              <th className="border border-black/40 px-2 py-1.5 text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {data.members.length === 0 ? (
              <tr>
                <td
                  colSpan={data.days.length + 2}
                  className="border border-black/40 px-2 py-2 text-black/60"
                >
                  No hours in this period.
                </td>
              </tr>
            ) : (
              data.members.map((m) => (
                <tr key={m.id}>
                  <td className="border border-black/40 px-2 py-1.5">{m.name}</td>
                  {data.days.map((d) => {
                    const hrs = m.per_day[d] ?? 0;
                    return (
                      <td
                        key={d}
                        className="whitespace-nowrap border border-black/40 px-2 py-1.5 text-right tabular-nums"
                      >
                        {hrs ? hrs : ""}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap border border-black/40 px-2 py-1.5 text-right font-medium tabular-nums">
                    {fmtHoursMinutes(m.total_minutes)} ({toHours(m.total_minutes)})
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data.members.some((m) => m.weeks.some((w) => w.over40)) && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold">Over 40 hours</h2>
          <ul className="mt-2 list-disc pl-5 text-[13px]">
            {data.members.flatMap((m) =>
              m.weeks
                .filter((w) => w.over40)
                .map((w) => (
                  <li key={`${m.id}-${w.week_start}`}>
                    {m.name} — week of {fmtShort(w.week_start)}: {toHours(w.minutes)}h
                  </li>
                ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function HoursReportPrintPage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <Suspense fallback={<p className="text-ink/50">Loading…</p>}>
        <PrintReport />
      </Suspense>
    </main>
  );
}
