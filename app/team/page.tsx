"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtShort } from "@/lib/dates";
import { ONBOARDING_STEPS, openOnboardingCount } from "@/lib/team-shared";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type Member = {
  id: number;
  staff_user_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  start_date: string | null;
  active: boolean;
  emergency_name: string | null;
  emergency_phone: string | null;
  max_shifts_per_week: number | null;
  onboarding: Record<string, boolean> | null;
  sms_opt_in: boolean;
  notes: string | null;
  login_username: string | null;
  login_active: boolean | null;
  hourly_rate: number | null;
};

type NewMember = {
  name: string;
  phone: string;
  email: string;
  start_date: string;
  max_shifts_per_week: string;
  emergency_name: string;
  emergency_phone: string;
  notes: string;
};

const EMPTY_NEW: NewMember = {
  name: "",
  phone: "",
  email: "",
  start_date: "",
  max_shifts_per_week: "",
  emergency_name: "",
  emergency_phone: "",
  notes: "",
};

export default function TeamPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [members, setMembers] = useState<Member[]>([]);
  const [logins, setLogins] = useState<{ id: number; username: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<NewMember>(EMPTY_NEW);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/members");
      if (!res.ok) throw new Error(`members ${res.status}`);
      setMembers(await res.json());
      setLoaded(true);
      // staff logins (for linking a member to their login)
      try {
        const sres = await fetch("/api/staff");
        if (sres.ok) setLogins(await sres.json());
      } catch {
        /* non-fatal */
      }
    } catch {
      setLoadError("Couldn't load the team — refresh to try again.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch("/api/team/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          phone: draft.phone.trim() || null,
          email: draft.email.trim() || null,
          start_date: draft.start_date || null,
          max_shifts_per_week: draft.max_shifts_per_week
            ? Math.max(0, Math.floor(Number(draft.max_shifts_per_week) || 0))
            : null,
          emergency_name: draft.emergency_name.trim() || null,
          emergency_phone: draft.emergency_phone.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(d.error || "Couldn't add that team member.");
      } else {
        setDraft(EMPTY_NEW);
        setShowForm(false);
        await load();
      }
    } catch {
      setFormError("Couldn't reach the studio — try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---- loading / access gates ----
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

  const active = members.filter((m) => m.active);
  const inactive = members.filter((m) => !m.active);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-serif text-4xl font-medium md:text-5xl">Team</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              Your front-desk crew, onboarding, and contact details.
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream"
          >
            {showForm ? "Close" : "+ Add team member"}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={addMember}
            className="mt-6 rounded-2xl border border-dashed border-ink/20 bg-white/70 p-5"
          >
            <p className="text-[13px] font-medium text-ink/70">New team member</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls}>Name</label>
                <input
                  className={inputCls}
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  className={inputCls}
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input
                  className={inputCls}
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Start date</label>
                <input
                  type="date"
                  className={inputCls}
                  value={draft.start_date}
                  onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Max shifts / week</label>
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={draft.max_shifts_per_week}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, max_shifts_per_week: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelCls}>Emergency contact name</label>
                <input
                  className={inputCls}
                  value={draft.emergency_name}
                  onChange={(e) => setDraft((d) => ({ ...d, emergency_name: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Emergency contact phone</label>
                <input
                  className={inputCls}
                  value={draft.emergency_phone}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, emergency_phone: e.target.value }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Notes</label>
                <textarea
                  rows={2}
                  className={inputCls}
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                />
              </div>
            </div>
            {formError && <p className="mt-2 text-sm text-blush-deep">{formError}</p>}
            <button
              type="submit"
              disabled={saving || !draft.name.trim()}
              className="mt-3 rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
            >
              {saving ? "Adding…" : "Add team member"}
            </button>
          </form>
        )}

        <p className="mt-4 text-[12px] text-ink/40">
          We never store SSNs, bank details, ID documents, or tax forms here.
        </p>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-6 space-y-4">
              {active.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                  No active team members yet.
                </p>
              ) : (
                active.map((m) => (
                  <MemberCard key={m.id} member={m} logins={logins} onChange={load} />
                ))
              )}
            </div>

            {inactive.length > 0 && (
              <div className="mt-10">
                <h2 className="font-serif text-xl italic text-ink/70">Inactive</h2>
                <div className="mt-3 space-y-4">
                  {inactive.map((m) => (
                    <MemberCard key={m.id} member={m} logins={logins} onChange={load} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function MemberCard({
  member,
  logins,
  onChange,
}: {
  member: Member;
  logins: { id: number; username: string; name: string }[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [linkSel, setLinkSel] = useState("");
  const [err, setErr] = useState("");
  const onboarding = member.onboarding || {};
  const open = openOnboardingCount(onboarding);

  // edit-form local state
  const [form, setForm] = useState({
    phone: member.phone ?? "",
    email: member.email ?? "",
    start_date: member.start_date ? member.start_date.slice(0, 10) : "",
    max_shifts_per_week:
      member.max_shifts_per_week != null ? String(member.max_shifts_per_week) : "",
    emergency_name: member.emergency_name ?? "",
    emergency_phone: member.emergency_phone ?? "",
    notes: member.notes ?? "",
    hourly_rate: member.hourly_rate != null ? String(member.hourly_rate) : "",
  });

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/team/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't save that change.");
        return false;
      }
      await onChange();
      return true;
    } catch {
      setErr("Couldn't reach the studio — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleStep(key: string, current: boolean) {
    await patch({ onboarding: { [key]: !current } });
  }

  async function deactivate() {
    if (
      !window.confirm(
        `Deactivate ${member.name}? This removes their access but keeps their history.`
      )
    )
      return;
    await patch({ active: false });
  }

  async function saveEdit() {
    const ok = await patch({
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      start_date: form.start_date || null,
      max_shifts_per_week: form.max_shifts_per_week
        ? Math.max(0, Math.floor(Number(form.max_shifts_per_week) || 0))
        : null,
      emergency_name: form.emergency_name.trim() || null,
      emergency_phone: form.emergency_phone.trim() || null,
      notes: form.notes.trim() || null,
      hourly_rate:
        form.hourly_rate.trim() === ""
          ? null
          : Math.max(0, Number(form.hourly_rate) || 0),
    });
    if (ok) setEditing(false);
  }

  return (
    <div
      className={`rounded-2xl bg-white p-4 ${member.active ? "" : "opacity-70"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold">{member.name}</span>
            {open > 0 && (
              <span className="rounded-full bg-butter px-2.5 py-0.5 text-[11px] text-ink/70">
                {open} open
              </span>
            )}
            {member.login_username ? (
              <span className="rounded-full bg-lavender/50 px-2.5 py-0.5 text-[11px] text-ink/70">
                Login: {member.login_username}
              </span>
            ) : (
              <span className="text-[11px] text-ink/40">No staff login yet</span>
            )}
          </div>
          <div className="mt-1.5 space-y-0.5 text-[13px] text-ink/55">
            {member.phone && <p>{member.phone}</p>}
            {member.email && <p>{member.email}</p>}
            {member.start_date && <p>Started {fmtShort(member.start_date.slice(0, 10))}</p>}
            {member.max_shifts_per_week != null && (
              <p>Max {member.max_shifts_per_week} shifts/week</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-full border border-ink/15 px-4 py-2 text-[13px]"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          {member.active ? (
            <button
              onClick={deactivate}
              disabled={busy}
              className="rounded-full border border-ink/15 px-4 py-2 text-[13px] text-ink/60 disabled:opacity-40"
            >
              Deactivate
            </button>
          ) : (
            <button
              onClick={() => patch({ active: true })}
              disabled={busy}
              className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream disabled:opacity-40"
            >
              Reactivate
            </button>
          )}
        </div>
      </div>

      {member.login_username ? (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink/50">
          <span>
            Staff login: <strong>{member.login_username}</strong>
          </span>
          <button
            onClick={() => patch({ staff_user_id: null })}
            disabled={busy}
            className="underline underline-offset-2 hover:text-ink disabled:opacity-40"
          >
            Unlink
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-ink/45">Link a staff login:</span>
          <select
            value={linkSel}
            onChange={(e) => setLinkSel(e.target.value)}
            className="rounded-lg border border-ink/15 bg-white px-2 py-1 text-[12px]"
          >
            <option value="">— choose —</option>
            {logins.map((l) => (
              <option key={l.id} value={l.id}>
                {l.username} ({l.name})
              </option>
            ))}
          </select>
          <button
            onClick={() => linkSel && patch({ staff_user_id: Number(linkSel) })}
            disabled={busy || !linkSel}
            className="rounded-full bg-ink px-3 py-1 text-[12px] text-cream disabled:opacity-40"
          >
            Link
          </button>
          <span className="text-ink/40">or create one in Settings → Staff logins</span>
        </div>
      )}

      {/* Onboarding checklist */}
      <div className="mt-3 flex flex-wrap gap-2">
        {ONBOARDING_STEPS.map((step) => {
          const done = !!onboarding[step.key];
          return (
            <button
              key={step.key}
              onClick={() => toggleStep(step.key, done)}
              disabled={busy}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] disabled:opacity-40 ${
                done
                  ? "border-sage-deep bg-sage/40 text-ink"
                  : "border-ink/15 bg-white text-ink/55"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                  done ? "border-sage-deep bg-sage-deep text-cream" : "border-ink/25"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              {step.label}
            </button>
          );
        })}
      </div>

      {editing && (
        <div className="mt-4 rounded-xl border border-ink/10 bg-cream/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Phone</label>
              <input
                className={inputCls}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                className={inputCls}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Start date</label>
              <input
                type="date"
                className={inputCls}
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Max shifts / week</label>
              <input
                type="number"
                min={0}
                className={inputCls}
                value={form.max_shifts_per_week}
                onChange={(e) =>
                  setForm((f) => ({ ...f, max_shifts_per_week: e.target.value }))
                }
              />
            </div>
            <div>
              <label className={labelCls}>Hourly rate (for labor estimate)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={inputCls}
                value={form.hourly_rate}
                onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
              />
              <p className="mt-1 text-[12px] text-ink/45">
                Admin only — never shown to staff. Used only for the labor-cost
                estimate, not payroll.
              </p>
            </div>
            <div>
              <label className={labelCls}>Emergency contact name</label>
              <input
                className={inputCls}
                value={form.emergency_name}
                onChange={(e) => setForm((f) => ({ ...f, emergency_name: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Emergency contact phone</label>
              <input
                className={inputCls}
                value={form.emergency_phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, emergency_phone: e.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea
                rows={2}
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}
          <button
            onClick={saveEdit}
            disabled={busy}
            className="mt-3 rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {err && !editing && <p className="mt-2 text-sm text-blush-deep">{err}</p>}
    </div>
  );
}
