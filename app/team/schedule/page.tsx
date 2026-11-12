"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fromISO, toISO, addDays, fmtShort, fmtWeekday, todayISO } from "@/lib/dates";

// --- client-safe helpers (no server imports) --------------------------------
function mondayOf(iso: string): string {
  const d = fromISO(iso);
  const dow = d.getDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}
function weekDates(ws: string): string[] {
  return Array.from({ length: 6 }, (_, i) => addDays(ws, i));
}
function weekLabel(ws: string): string {
  return `${fmtShort(ws)} – ${fmtShort(addDays(ws, 5))}`;
}
function prettyTime(hhmm: string): string {
  const [h, m] = (hhmm || "").split(":");
  const hn = Number(h);
  if (Number.isNaN(hn)) return hhmm;
  return `${((hn + 11) % 12) + 1}:${(m ?? "00").padStart(2, "0")} ${hn < 12 ? "AM" : "PM"}`;
}
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CONFLICT_LABEL: Record<string, string> = {
  timeoff: "On approved time off",
  unavailable_recurring: "Usually off this weekday",
  unavailable_date: "Marked unavailable",
  over_max: "Over their weekly max",
  double_booked: "Double-booked",
};

type Member = { id: number; name: string; max_shifts_per_week: number | null };
type Shift = {
  id: number;
  shift_date: string;
  start_time: string;
  end_time: string;
  team_member_id: number | null;
  is_training: boolean;
  note: string | null;
};
type WeekData = {
  week_start: string;
  week_label: string;
  dates: string[];
  status: "draft" | "published";
  published_at: string | null;
  default_start: string;
  default_end: string;
  shifts: Shift[];
  members: Member[];
  counts: Record<number, number>;
  conflicts: Record<number, string[]>;
};

export default function SchedulePage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";

  const [view, setView] = useState<"week" | "month">("week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()));
  const [data, setData] = useState<WeekData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showTemplate, setShowTemplate] = useState(false);

  const loadWeek = useCallback(async (ws: string) => {
    try {
      const r = await fetch(`/api/team/schedule?week=${ws}`);
      if (r.ok) setData(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadWeek(weekStart);
  }, [isAdmin, weekStart, loadWeek]);

  async function saveShift(date: string, patch: Partial<Shift>) {
    if (!data) return;
    const existing = data.shifts.find((s) => s.shift_date === date);
    const body = {
      date,
      team_member_id:
        "team_member_id" in patch ? patch.team_member_id : existing?.team_member_id ?? null,
      start_time: patch.start_time ?? existing?.start_time ?? data.default_start,
      end_time: patch.end_time ?? existing?.end_time ?? data.default_end,
      is_training: "is_training" in patch ? patch.is_training : existing?.is_training ?? false,
      note: "note" in patch ? patch.note : existing?.note ?? null,
    };
    setBusy(true);
    try {
      await fetch("/api/team/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadWeek(weekStart);
    } finally {
      setBusy(false);
    }
  }

  async function publish(pub: boolean) {
    if (pub && !confirm(`Publish ${weekLabel(weekStart)}? Staff will see it and be notified.`)) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/team/schedule/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: weekStart, publish: pub }),
      });
      const d = await r.json();
      if (pub) setMsg(`Published — ${d.notified ?? 0} staff emailed.`);
      await loadWeek(weekStart);
    } finally {
      setBusy(false);
    }
  }

  async function copyLastWeek() {
    if (!confirm("Copy last week's assignments into this week? This overwrites the current week.")) return;
    setBusy(true);
    try {
      await fetch("/api/team/schedule/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: weekStart }),
      });
      await loadWeek(weekStart);
      setMsg("Copied last week.");
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate() {
    if (!confirm("Apply the repeating template to this week? This overwrites the current week.")) return;
    setBusy(true);
    try {
      await fetch("/api/team/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week: weekStart }),
      });
      await loadWeek(weekStart);
      setMsg("Template applied.");
    } finally {
      setBusy(false);
    }
  }

  if (!meLoading && !isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-5 py-12">
          <p className="rounded-2xl bg-white p-6 text-ink/60">Admins only.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-4xl font-medium md:text-5xl">Schedule</h1>
          <div className="flex gap-1.5">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-4 py-1.5 text-[13px] capitalize ${
                  view === v ? "bg-ink text-cream" : "bg-white text-ink/60"
                }`}
              >
                {v}ly
              </button>
            ))}
          </div>
        </div>

        {/* Week navigation + status */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-full border border-ink/15 px-3 py-1.5 text-[13px]">
              ← Prev
            </button>
            <span className="text-[15px] font-medium">{weekLabel(weekStart)}</span>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-full border border-ink/15 px-3 py-1.5 text-[13px]">
              Next →
            </button>
            <button onClick={() => setWeekStart(mondayOf(todayISO()))} className="rounded-full px-3 py-1.5 text-[13px] text-ink/50">
              This week
            </button>
          </div>
          {data && (
            <span
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${
                data.status === "published" ? "bg-sage text-ink" : "bg-butter text-ink"
              }`}
            >
              {data.status === "published" ? "Published" : "Draft"}
            </span>
          )}
        </div>

        {msg && <p className="mt-3 rounded-xl bg-sage/25 px-4 py-2 text-[13px]">{msg}</p>}

        {!data ? (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : view === "week" ? (
          <>
            {/* Action row */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={copyLastWeek} disabled={busy} className="rounded-full border border-ink/15 px-4 py-2 text-[13px] disabled:opacity-40">
                Copy last week
              </button>
              <button onClick={applyTemplate} disabled={busy} className="rounded-full border border-ink/15 px-4 py-2 text-[13px] disabled:opacity-40">
                Apply template
              </button>
              <button onClick={() => setShowTemplate((s) => !s)} className="rounded-full border border-ink/15 px-4 py-2 text-[13px]">
                {showTemplate ? "Hide template" : "Edit template"}
              </button>
              <div className="flex-1" />
              {data.status === "published" ? (
                <button onClick={() => publish(false)} disabled={busy} className="rounded-full border border-ink/25 px-4 py-2 text-[13px] disabled:opacity-40">
                  Unpublish
                </button>
              ) : (
                <button onClick={() => publish(true)} disabled={busy} className="rounded-full bg-ink px-5 py-2 text-[13px] text-cream disabled:opacity-40">
                  Publish week
                </button>
              )}
            </div>

            {showTemplate && <TemplateEditor members={data.members} onSaved={() => setMsg("Template saved.")} />}

            {/* Day rows */}
            <div className="mt-4 space-y-2">
              {weekDates(weekStart).map((date) => {
                const shift = data.shifts.find((s) => s.shift_date === date) || null;
                const conflicts = shift ? data.conflicts[shift.id] || [] : [];
                return (
                  <DayRow
                    key={date}
                    date={date}
                    shift={shift}
                    members={data.members}
                    defaults={{ start: data.default_start, end: data.default_end }}
                    conflicts={conflicts}
                    busy={busy}
                    onSave={saveShift}
                  />
                );
              })}
            </div>

            {/* Per-person weekly counts */}
            <section className="mt-6 rounded-2xl bg-white p-4">
              <h2 className="text-[15px] font-medium">Shifts per person this week</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.members.map((m) => {
                  const n = data.counts[m.id] || 0;
                  const over = m.max_shifts_per_week != null && n > m.max_shifts_per_week;
                  return (
                    <span
                      key={m.id}
                      className={`rounded-full px-3 py-1 text-[13px] ${
                        over ? "bg-blush-deep text-cream" : n > 0 ? "bg-lavender" : "bg-ink/5 text-ink/50"
                      }`}
                    >
                      {m.name}: {n}
                      {m.max_shifts_per_week != null ? ` / ${m.max_shifts_per_week}` : ""}
                      {over ? " ⚠" : ""}
                    </span>
                  );
                })}
                {data.members.length === 0 && (
                  <span className="text-[13px] text-ink/45">No active team members yet — add them under Team → Members.</span>
                )}
              </div>
            </section>
          </>
        ) : (
          <MonthView weekStart={weekStart} onPickWeek={(ws) => { setWeekStart(ws); setView("week"); }} />
        )}
      </div>
    </AppShell>
  );
}

function DayRow({
  date,
  shift,
  members,
  defaults,
  conflicts,
  busy,
  onSave,
}: {
  date: string;
  shift: Shift | null;
  members: Member[];
  defaults: { start: string; end: string };
  conflicts: string[];
  busy: boolean;
  onSave: (date: string, patch: Partial<Shift>) => void;
}) {
  const assigned = shift?.team_member_id ?? null;
  const unassigned = assigned == null;
  const [start, setStart] = useState(shift?.start_time ?? defaults.start);
  const [end, setEnd] = useState(shift?.end_time ?? defaults.end);
  useEffect(() => {
    setStart(shift?.start_time ?? defaults.start);
    setEnd(shift?.end_time ?? defaults.end);
  }, [shift?.start_time, shift?.end_time, defaults.start, defaults.end]);

  return (
    <div
      className={`rounded-2xl border p-3 ${
        unassigned ? "border-blush-deep/50 bg-blush/15" : "border-ink/10 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[110px]">
          <p className="text-[13px] font-medium">{WD[fromISO(date).getDay()]}</p>
          <p className="text-[12px] text-ink/50">{fmtShort(date)}</p>
        </div>

        <select
          value={assigned ?? ""}
          disabled={busy}
          onChange={(e) => onSave(date, { team_member_id: e.target.value ? Number(e.target.value) : null })}
          className={`rounded-xl border px-3 py-2 text-[14px] outline-none ${
            unassigned ? "border-blush-deep/50 bg-white text-blush-deep" : "border-ink/15 bg-white"
          }`}
        >
          <option value="">— Unassigned —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <input
          type="time"
          value={start}
          disabled={busy}
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => start !== (shift?.start_time ?? defaults.start) && onSave(date, { start_time: start })}
          className="rounded-xl border border-ink/15 bg-white px-2 py-2 text-[14px]"
        />
        <span className="text-ink/40">–</span>
        <input
          type="time"
          value={end}
          disabled={busy}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={() => end !== (shift?.end_time ?? defaults.end) && onSave(date, { end_time: end })}
          className="rounded-xl border border-ink/15 bg-white px-2 py-2 text-[14px]"
        />

        <label className="flex items-center gap-1.5 text-[13px]">
          <input
            type="checkbox"
            checked={shift?.is_training ?? false}
            disabled={busy}
            onChange={(e) => onSave(date, { is_training: e.target.checked })}
            className="h-4 w-4 accent-ink"
          />
          Training
        </label>
      </div>

      {unassigned && (
        <p className="mt-1.5 text-[12px] font-medium text-blush-deep">Unassigned — no one covers this day yet.</p>
      )}
      {conflicts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {conflicts.map((c) => (
            <span key={c} className="rounded-full bg-blush-deep px-2.5 py-0.5 text-[11px] text-cream">
              ⚠ {CONFLICT_LABEL[c] || c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ members, onSaved }: { members: Member[]; onSaved: () => void }) {
  type Row = { weekday: number; team_member_id: number | null; start_time: string; end_time: string; is_training: boolean; enabled: boolean };
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/team/template")
      .then((r) => (r.ok ? r.json() : []))
      .then((existing: Row[]) => {
        const byDay = new Map(existing.map((e) => [e.weekday, e]));
        setRows(
          Array.from({ length: 6 }, (_, i) => {
            const wd = i + 1; // Mon=1 … Sat=6
            return (
              byDay.get(wd) || {
                weekday: wd,
                team_member_id: null,
                start_time: "11:55",
                end_time: "16:55",
                is_training: false,
                enabled: true,
              }
            );
          })
        );
      });
  }, []);

  async function save() {
    if (!rows) return;
    await fetch("/api/team/template", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    onSaved();
  }

  if (!rows) return <div className="mt-3 h-24 animate-pulse rounded-2xl bg-ink/5" />;
  return (
    <section className="mt-3 rounded-2xl border border-ink/10 bg-white p-4">
      <h2 className="text-[15px] font-medium">Repeating weekly template</h2>
      <p className="mt-0.5 text-[12px] text-ink/50">Set a default person per weekday, then “Apply template” to any week.</p>
      <div className="mt-3 space-y-1.5">
        {rows.map((row, idx) => (
          <div key={row.weekday} className="flex flex-wrap items-center gap-2">
            <span className="min-w-[44px] text-[13px] font-medium">{WD[row.weekday]}</span>
            <select
              value={row.team_member_id ?? ""}
              onChange={(e) =>
                setRows((rs) => rs!.map((r, i) => (i === idx ? { ...r, team_member_id: e.target.value ? Number(e.target.value) : null } : r)))
              }
              className="rounded-xl border border-ink/15 bg-white px-3 py-1.5 text-[13px]"
            >
              <option value="">— none —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={row.is_training}
                onChange={(e) => setRows((rs) => rs!.map((r, i) => (i === idx ? { ...r, is_training: e.target.checked } : r)))}
                className="h-4 w-4 accent-ink"
              />
              Training
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-ink/50">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => setRows((rs) => rs!.map((r, i) => (i === idx ? { ...r, enabled: e.target.checked } : r)))}
                className="h-4 w-4 accent-ink"
              />
              On
            </label>
          </div>
        ))}
      </div>
      <button onClick={save} className="mt-3 rounded-full bg-ink px-5 py-2 text-[13px] text-cream">
        Save template
      </button>
    </section>
  );
}

function MonthView({ weekStart, onPickWeek }: { weekStart: string; onPickWeek: (ws: string) => void }) {
  const anchor = fromISO(weekStart);
  const [year, setYear] = useState(anchor.getFullYear());
  const [month, setMonth] = useState(anchor.getMonth()); // 0-11
  const [shifts, setShifts] = useState<{ shift_date: string; member_name: string | null; team_member_id: number | null; is_training: boolean }[]>([]);
  const [pub, setPub] = useState<Set<string>>(new Set());

  useEffect(() => {
    const first = toISO(new Date(year, month, 1));
    const last = toISO(new Date(year, month + 1, 0));
    fetch(`/api/team/schedule?from=${first}&to=${last}`)
      .then((r) => (r.ok ? r.json() : { shifts: [], weeks: [] }))
      .then((d) => {
        setShifts(d.shifts || []);
        setPub(new Set((d.weeks || []).filter((w: { status: string }) => w.status === "published").map((w: { week_start: string }) => w.week_start)));
      });
  }, [year, month]);

  const byDate = new Map(shifts.map((s) => [s.shift_date, s]));
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISO(new Date(year, month, d)));

  function shiftMonth(delta: number) {
    const m = month + delta;
    const y = year + Math.floor(m / 12);
    setYear(y);
    setMonth(((m % 12) + 12) % 12);
  }
  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="mt-4 rounded-2xl bg-white p-4">
      <div className="flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="rounded-full border border-ink/15 px-3 py-1.5 text-[13px]">←</button>
        <span className="text-[15px] font-medium">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} className="rounded-full border border-ink/15 px-3 py-1.5 text-[13px]">→</button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-ink/45">
        {WD.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const dow = fromISO(date).getDay();
          const s = byDate.get(date);
          const isWorkday = dow >= 1 && dow <= 6;
          const unassigned = isWorkday && (!s || s.team_member_id == null);
          return (
            <button
              key={i}
              onClick={() => onPickWeek(mondayOf(date))}
              className={`min-h-[56px] rounded-lg border p-1 text-left text-[11px] transition-colors hover:border-ink/40 ${
                unassigned ? "border-blush-deep/40 bg-blush/10" : s?.team_member_id ? "border-sage-deep/30 bg-sage/15" : "border-ink/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-ink/50">{fromISO(date).getDate()}</span>
                {pub.has(mondayOf(date)) && <span className="h-1.5 w-1.5 rounded-full bg-sage-deep" title="Published" />}
              </div>
              {s?.member_name && <span className="mt-0.5 block truncate">{s.member_name.split(" ")[0]}</span>}
              {unassigned && <span className="mt-0.5 block text-blush-deep">—</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-ink/45">Tap any day to open that week. Green = covered, pink = unassigned, dot = published.</p>
    </div>
  );
}
