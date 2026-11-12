"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fromISO, fmtShort } from "@/lib/dates";
import { fmtHoursMinutes, toHours } from "@/lib/timeclock-shared";

const outlineBtn = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";

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

export default function HoursReportPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [data, setData] = useState<Resp | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async (pivot: string) => {
    try {
      const res = await fetch(
        `/api/team/hours-report?period=${encodeURIComponent(pivot || "")}`
      );
      if (!res.ok) throw new Error(`hours-report ${res.status}`);
      setData(await res.json());
      setLoaded(true);
    } catch {
      setLoadError("Couldn't load the hours report — refresh to try again.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load("");
  }, [isAdmin, load]);

  if (meLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }
  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
          <p className="text-center text-ink/50">Admins only.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Hours report</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          Hours come from exact clock in/out times — no rounding. For
          payroll/accounting.
        </p>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded || !data ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => load(data.prev)}
                  className={outlineBtn}
                  aria-label="Previous period"
                >
                  ←
                </button>
                <span className="text-[15px] font-medium">{data.period.label}</span>
                <button
                  onClick={() => load(data.next)}
                  className={outlineBtn}
                  aria-label="Next period"
                >
                  →
                </button>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/team/hours-report/export?period=${encodeURIComponent(
                    data.period.start
                  )}`}
                  className={outlineBtn}
                >
                  Download CSV
                </a>
                <a
                  href={`/team/hours-report/print?period=${encodeURIComponent(
                    data.period.start
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={outlineBtn}
                >
                  Save as PDF
                </a>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto rounded-2xl bg-white p-4">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="text-left text-ink/50">
                    <th className="sticky left-0 bg-white px-2 py-2 font-medium">
                      Employee
                    </th>
                    {data.days.map((d) => (
                      <th
                        key={d}
                        className="whitespace-nowrap px-2 py-2 text-right font-medium"
                      >
                        {dayHeader(d)}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.length === 0 ? (
                    <tr>
                      <td
                        colSpan={data.days.length + 2}
                        className="px-2 py-4 text-ink/45"
                      >
                        No hours in this period.
                      </td>
                    </tr>
                  ) : (
                    data.members.map((m) => (
                      <tr key={m.id} className="border-t border-ink/10">
                        <td className="sticky left-0 bg-white px-2 py-2 align-top">
                          <div className="font-medium">{m.name}</div>
                          <div className="mt-1 flex flex-col gap-1">
                            {m.weeks
                              .filter((w) => w.over40)
                              .map((w) => (
                                <span
                                  key={w.week_start}
                                  className="inline-block w-fit rounded-full bg-blush-deep px-2.5 py-0.5 text-[11px] text-cream"
                                >
                                  ⚠ Week of {fmtShort(w.week_start)} over 40h (
                                  {toHours(w.minutes)}h)
                                </span>
                              ))}
                          </div>
                        </td>
                        {data.days.map((d) => {
                          const hrs = m.per_day[d] ?? 0;
                          return (
                            <td
                              key={d}
                              className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                            >
                              {hrs ? hrs : ""}
                            </td>
                          );
                        })}
                        <td className="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums">
                          {fmtHoursMinutes(m.total_minutes)}{" "}
                          <span className="text-ink/45">
                            ({toHours(m.total_minutes)})
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
