"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { AmbassadorProgram, DEFAULT_PROGRAM } from "@/lib/types";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

export default function SettingsPage() {
  const [program, setProgram] = useState<AmbassadorProgram>(DEFAULT_PROGRAM);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [newDate, setNewDate] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const d = await res.json();
        setProgram(d.program);
      }
      setLoaded(true);
    })();
  }, []);

  function setCredit(
    tier: "curator" | "poster",
    field: "free" | "rate",
    value: string
  ) {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    setProgram((p) => ({
      ...p,
      credits: { ...p.credits, [tier]: { ...p.credits[tier], [field]: n } },
    }));
  }

  function addDate() {
    const d = newDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    setProgram((p) => ({
      ...p,
      blackout_dates: Array.from(new Set([...p.blackout_dates, d])).sort(),
    }));
    setNewDate("");
  }
  function removeDate(d: string) {
    setProgram((p) => ({
      ...p,
      blackout_dates: p.blackout_dates.filter((x) => x !== d),
    }));
  }

  async function save() {
    setSaving(true);
    setSavedAt(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ program }),
    });
    if (res.ok) {
      const d = await res.json();
      setProgram(d.program);
      setSavedAt(true);
    }
    setSaving(false);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="text-4xl font-medium md:text-5xl">Settings</h1>
        <p className="mt-1.5 text-sm text-ink/50">Ambassador perk program</p>

        {!loaded ? (
          <div className="mt-8 h-64 animate-pulse rounded-2xl bg-ink/5" />
        ) : (
          <>
            {/* Monthly credit allowances */}
            <section className="mt-8 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Monthly credits per ambassador
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Reset on the 1st of each month.
              </p>
              {(["curator", "poster"] as const).map((tier) => (
                <div key={tier} className="mt-4">
                  <p className="mb-1.5 text-[15px] font-medium capitalize">{tier}s</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Free rentals</label>
                      <input
                        type="number"
                        min={0}
                        className={inputCls}
                        value={program.credits[tier].free}
                        onChange={(e) => setCredit(tier, "free", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>$-rate rentals</label>
                      <input
                        type="number"
                        min={0}
                        className={inputCls}
                        value={program.credits[tier].rate}
                        onChange={(e) => setCredit(tier, "rate", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Cleaning &amp; Care Fee ($ / paying rental)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.cleaning_fee}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        cleaning_fee: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>Ambassador $-rate ($ / cleaning cost)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={program.cleaning_rate}
                    onChange={(e) =>
                      setProgram((p) => ({
                        ...p,
                        cleaning_rate: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
              </div>
              <p className="mt-3 text-[12px] text-ink/45">
                Curators also earn +1 bonus free credit each time a piece they proposed is accepted.
              </p>
              <div className="mt-4 max-w-[14rem]">
                <label className={labelCls}>Post store credit ($ / posted rental)</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={program.post_credit}
                  onChange={(e) =>
                    setProgram((p) => ({
                      ...p,
                      post_credit: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    }))
                  }
                />
                <p className="mt-1 text-[12px] text-ink/45">
                  Credit a customer earns when they post a rental; auto-applies at their next checkout.
                </p>
              </div>
            </section>

            {/* Posting target */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Posting target</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Posts expected per ambassador each month. Pace-based: an ambassador is
                flagged &quot;Behind&quot; when they fall below the expected pace for how far
                into the month it is.
              </p>
              <div className="mt-3 max-w-[10rem]">
                <label className={labelCls}>Posts / month</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={program.posting_target}
                  onChange={(e) =>
                    setProgram((p) => ({
                      ...p,
                      posting_target: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    }))
                  }
                />
              </div>
            </section>

            {/* Blackout dates */}
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Peak blackout dates
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                On these days, ambassador free/$-rate perks don&apos;t apply — full price is
                charged and paying customers are prioritized.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="date"
                  className={inputCls}
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                <button
                  onClick={addDate}
                  className="shrink-0 rounded-xl bg-ink px-4 text-[15px] text-cream"
                >
                  Add
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {program.blackout_dates.length === 0 ? (
                  <p className="text-sm text-ink/40">No blackout dates set.</p>
                ) : (
                  program.blackout_dates.map((d) => (
                    <span
                      key={d}
                      className="flex items-center gap-1.5 rounded-full bg-blush/40 px-3 py-1 text-sm"
                    >
                      {d}
                      <button
                        onClick={() => removeDate(d)}
                        className="text-ink/40 hover:text-ink"
                        aria-label="Remove date"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </section>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
              {savedAt && <span className="text-sm text-sage-deep">Saved ✓</span>}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
