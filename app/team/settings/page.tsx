"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { prettyRange } from "@/lib/team-shared";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type TeamSettings = {
  sms_enabled: boolean;
  sms_from_approved: boolean;
  owner_sms: string;
  default_start: string;
  default_end: string;
  pay_period_frequency: "weekly" | "biweekly" | "semimonthly";
  pay_period_anchor: string;
};

export default function TeamSettingsPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await fetch("/api/team/settings");
        if (!res.ok) throw new Error(`settings ${res.status}`);
        setSettings(await res.json());
      } catch {
        setLoadError("Couldn't load team settings — refresh to try again.");
      }
    })();
  }, [isAdmin]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSavedAt(false);
    setSaveError("");
    try {
      const res = await fetch("/api/team/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sms_enabled: settings.sms_enabled,
          sms_from_approved: settings.sms_from_approved,
          owner_sms: settings.owner_sms,
          pay_period_frequency: settings.pay_period_frequency,
          pay_period_anchor: settings.pay_period_anchor || null,
        }),
      });
      if (!res.ok) {
        setSaveError("Couldn't save — try again.");
      } else {
        setSettings(await res.json());
        setSavedAt(true);
      }
    } catch {
      setSaveError("Couldn't reach the studio — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }
  if (!isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
          <p className="text-center text-ink/50">Admins only.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Team settings</h1>
        <p className="mt-1.5 text-sm text-ink/50">Alerts and scheduling defaults.</p>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !settings ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">
                Text message alerts (SMS)
              </h2>
              <p className="mt-1 text-[13px] text-ink/50">
                In-app and email alerts are always on. SMS is off until your sending
                number is approved.
              </p>

              <div className="mt-4 space-y-3">
                <label className="flex items-start gap-3 rounded-xl bg-white p-3.5 text-[14px]">
                  <input
                    type="checkbox"
                    checked={settings.sms_from_approved}
                    onChange={(e) =>
                      setSettings((s) =>
                        s
                          ? {
                              ...s,
                              sms_from_approved: e.target.checked,
                              // if approval is revoked, SMS can't stay on
                              sms_enabled: e.target.checked ? s.sms_enabled : false,
                            }
                          : s
                      )
                    }
                    className="mt-0.5 h-4 w-4 accent-ink"
                  />
                  <span>
                    My sending text number is approved
                    <span className="mt-0.5 block text-[12px] text-ink/45">
                      Check this once your carrier / provider has approved the number
                      you&apos;ll send from.
                    </span>
                  </span>
                </label>

                <label
                  className={`flex items-start gap-3 rounded-xl bg-white p-3.5 text-[14px] ${
                    settings.sms_from_approved ? "" : "opacity-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={!settings.sms_from_approved}
                    checked={settings.sms_enabled}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, sms_enabled: e.target.checked } : s))
                    }
                    className="mt-0.5 h-4 w-4 accent-ink"
                  />
                  <span>
                    Send SMS alerts
                    <span className="mt-0.5 block text-[12px] text-ink/45">
                      {settings.sms_from_approved
                        ? "Turn on text alerts for the team."
                        : "Available once your sending number is approved above."}
                    </span>
                  </span>
                </label>

                <div>
                  <label className={labelCls}>Your mobile number</label>
                  <input
                    className={inputCls}
                    placeholder="(555) 123-4567"
                    value={settings.owner_sms}
                    onChange={(e) =>
                      setSettings((s) => (s ? { ...s, owner_sms: e.target.value } : s))
                    }
                  />
                  <p className="mt-1 text-[12px] text-ink/45">
                    Where owner alerts are texted when SMS is on.
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
                {savedAt && <span className="text-sm text-sage-deep">Saved ✓</span>}
                {saveError && <span className="text-sm text-blush-deep">{saveError}</span>}
              </div>
            </section>

            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Default shift</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                Used when building the weekly schedule. Informational here.
              </p>
              <p className="mt-2 text-[15px] text-ink/70">
                Default shift: {prettyRange(settings.default_start, settings.default_end)}
              </p>
            </section>

            <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
              <h2 className="font-serif text-xl italic text-ink/70">Pay period</h2>
              <p className="mt-1 text-[13px] text-ink/50">
                How timesheets and the hours report are grouped for payroll.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Frequency</label>
                  <select
                    className={inputCls}
                    value={settings.pay_period_frequency}
                    onChange={(e) =>
                      setSettings((s) =>
                        s
                          ? {
                              ...s,
                              pay_period_frequency: e.target
                                .value as TeamSettings["pay_period_frequency"],
                            }
                          : s
                      )
                    }
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="semimonthly">Semi-monthly</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Anchor date</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={settings.pay_period_anchor?.slice(0, 10) ?? ""}
                    onChange={(e) =>
                      setSettings((s) =>
                        s ? { ...s, pay_period_anchor: e.target.value } : s
                      )
                    }
                  />
                  <p className="mt-1 text-[12px] text-ink/45">
                    First day of a pay period — used for weekly/biweekly.
                  </p>
                </div>
              </div>

              {settings.pay_period_frequency === "semimonthly" && (
                <p className="mt-3 text-[12px] text-ink/45">
                  Semi-monthly uses the 1st–15th and 16th–end of month (anchor
                  ignored).
                </p>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
                {savedAt && <span className="text-sm text-sage-deep">Saved ✓</span>}
                {saveError && (
                  <span className="text-sm text-blush-deep">{saveError}</span>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
