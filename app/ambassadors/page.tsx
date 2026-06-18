"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import {
  Ambassador,
  AmbassadorProposal,
  AmbassadorTier,
  AmbassadorStatus,
  AmbassadorCredits,
  AmbassadorPost,
  AmbassadorReferral,
  AMBASSADOR_TIERS,
  AMBASSADOR_STATUSES,
  MONTHS,
  ambassadorTierLabel,
} from "@/lib/types";
import { fmtShort, todayISO } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type Row = Ambassador & {
  customer_name: string | null;
  consignor_name: string | null;
  sourced_count: number;
  proposal_count: number;
  referral_count: number;
  post_count: number;
  posting_target: number;
  posting_on_track: boolean;
};
type SourcedItem = {
  id: string;
  brand: string;
  barcode: string | null;
  size: string;
  color: string | null;
  status: string;
  photo_url: string | null;
  rental_count: number;
};
type Detail = Ambassador & {
  customer_name: string | null;
  consignor_name: string | null;
  credits: AmbassadorCredits;
  sourced_items: SourcedItem[];
  proposals: AmbassadorProposal[];
  posts: AmbassadorPost[];
  post_count: number;
  posting_target: number;
  posting_on_track: boolean;
  referrals: AmbassadorReferral[];
  referral_count: number;
};

function TierBadge({ tier }: { tier: AmbassadorTier }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
        tier === "curator" ? "bg-lavender" : "bg-sage"
      }`}
    >
      {ambassadorTierLabel(tier)}
    </span>
  );
}

/** Shared field editor used by both create and edit. */
function AmbassadorFields(p: {
  name: string;
  setName: (v: string) => void;
  instagram: string;
  setInstagram: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  sorority: string;
  setSorority: (v: string) => void;
  tier: AmbassadorTier;
  setTier: (v: AmbassadorTier) => void;
  status: AmbassadorStatus;
  setStatus: (v: AmbassadorStatus) => void;
  joinDate: string;
  setJoinDate: (v: string) => void;
  referralCode: string;
  setReferralCode: (v: string) => void;
  months: string[];
  toggleMonth: (m: string) => void;
  notes: string;
  setNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Name *</label>
          <input className={inputCls} value={p.name} onChange={(e) => p.setName(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Instagram</label>
          <input className={inputCls} value={p.instagram} onChange={(e) => p.setInstagram(e.target.value)} placeholder="@handle" />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input className={inputCls} value={p.phone} onChange={(e) => p.setPhone(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Sorority</label>
          <input className={inputCls} value={p.sorority} onChange={(e) => p.setSorority(e.target.value)} placeholder="e.g. Kappa Delta" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Tier</label>
          <div className="flex gap-2">
            {AMBASSADOR_TIERS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => p.setTier(t.value)}
                className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                  p.tier === t.value ? "border-ink bg-ink text-cream" : "border-ink/15 bg-white text-ink/70"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <div className="flex gap-2">
            {AMBASSADOR_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => p.setStatus(s.value)}
                className={`flex-1 rounded-full border px-3 py-2 text-sm ${
                  p.status === s.value ? "border-ink bg-ink text-cream" : "border-ink/15 bg-white text-ink/70"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Join date</label>
          <input type="date" className={inputCls} value={p.joinDate} onChange={(e) => p.setJoinDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Referral code</label>
          <input
            className={`${inputCls} font-mono uppercase`}
            value={p.referralCode}
            onChange={(e) => p.setReferralCode(e.target.value.toUpperCase())}
            placeholder="Auto-generated if blank"
          />
        </div>
      </div>

      {p.tier === "poster" && (
        <div>
          <label className={labelCls}>Active months (posters rotate monthly)</label>
          <div className="flex flex-wrap gap-1.5">
            {MONTHS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => p.toggleMonth(m)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  p.months.includes(m) ? "border-sage-deep bg-sage text-ink" : "border-ink/15 bg-white text-ink/60"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className={labelCls}>Notes</label>
        <input className={inputCls} value={p.notes} onChange={(e) => p.setNotes(e.target.value)} />
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [sorority, setSorority] = useState("");
  const [tier, setTier] = useState<AmbassadorTier>("poster");
  const [status, setStatus] = useState<AmbassadorStatus>("active");
  const [joinDate, setJoinDate] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleMonth(m: string) {
    setMonths((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function save() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/ambassadors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        instagram: instagram.trim(),
        phone: phone.trim(),
        sorority: sorority.trim(),
        tier,
        status,
        join_date: joinDate || null,
        referral_code: referralCode.trim() || null,
        active_months: tier === "poster" ? months : [],
        notes: notes.trim(),
      }),
    });
    if (res.ok) {
      onCreated();
      onClose();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't save — try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between">
          <h2 className="text-3xl font-medium">New ambassador</h2>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5" aria-label="Close">×</button>
        </div>
        <AmbassadorFields
          name={name} setName={setName} instagram={instagram} setInstagram={setInstagram}
          phone={phone} setPhone={setPhone} sorority={sorority} setSorority={setSorority}
          tier={tier} setTier={setTier} status={status} setStatus={setStatus}
          joinDate={joinDate} setJoinDate={setJoinDate} referralCode={referralCode} setReferralCode={setReferralCode}
          months={months} toggleMonth={toggleMonth} notes={notes} setNotes={setNotes}
        />
        <p className="mt-3 text-[12px] text-ink/45">A linked customer record is created automatically so they can also rent.</p>
        {error && <p className="mt-3 text-sm text-blush-deep">{error}</p>}
        <button onClick={save} disabled={saving} className="mt-5 w-full rounded-full bg-ink px-6 py-3.5 text-base text-cream disabled:opacity-40">
          {saving ? "Saving…" : "Add ambassador"}
        </button>
      </div>
    </div>
  );
}

function DetailModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // edit state
  const [name, setName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [sorority, setSorority] = useState("");
  const [tier, setTier] = useState<AmbassadorTier>("poster");
  const [status, setStatus] = useState<AmbassadorStatus>("active");
  const [joinDate, setJoinDate] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  // proposal entry
  const [newProposal, setNewProposal] = useState("");

  // post entry
  const [postDate, setPostDate] = useState(todayISO());
  const [postLink, setPostLink] = useState("");
  const [postNote, setPostNote] = useState("");

  async function load() {
    const res = await fetch(`/api/ambassadors/${id}`);
    if (res.ok) {
      const d: Detail = await res.json();
      setDetail(d);
      setName(d.name);
      setInstagram(d.instagram ?? "");
      setPhone(d.phone ?? "");
      setSorority(d.sorority ?? "");
      setTier(d.tier);
      setStatus(d.status);
      setJoinDate(d.join_date ? d.join_date.slice(0, 10) : "");
      setReferralCode(d.referral_code ?? "");
      setMonths(d.active_months ?? []);
      setNotes(d.notes ?? "");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function toggleMonth(m: string) {
    setMonths((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function saveEdit() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/ambassadors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(), instagram: instagram.trim(), phone: phone.trim(),
        sorority: sorority.trim(), tier, status, join_date: joinDate || null,
        referral_code: referralCode.trim() || null,
        active_months: tier === "poster" ? months : [],
        customer_id: detail?.customer_id ?? null,
        consignor_id: detail?.consignor_id ?? null,
        notes: notes.trim(),
      }),
    });
    if (res.ok) {
      setEditing(false);
      onChanged();
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Couldn't save — try again.");
    }
    setBusy(false);
  }

  async function createConsignor() {
    setBusy(true);
    await fetch(`/api/ambassadors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_consignor" }),
    });
    onChanged();
    await load();
    setBusy(false);
  }

  async function addProposal() {
    if (!newProposal.trim()) return;
    await fetch(`/api/ambassadors/${id}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: newProposal.trim() }),
    });
    setNewProposal("");
    await load();
  }
  async function toggleProposal(p: AmbassadorProposal) {
    await fetch(`/api/ambassadors/${id}/proposals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal_id: p.id, accepted: !p.accepted }),
    });
    await load();
  }
  async function removeProposal(p: AmbassadorProposal) {
    await fetch(`/api/ambassadors/${id}/proposals`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal_id: p.id }),
    });
    await load();
  }

  async function addPost() {
    await fetch(`/api/ambassadors/${id}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posted_on: postDate || null,
        link: postLink.trim(),
        note: postNote.trim(),
      }),
    });
    setPostLink("");
    setPostNote("");
    setPostDate(todayISO());
    await load();
  }
  async function removePost(p: AmbassadorPost) {
    await fetch(`/api/ambassadors/${id}/posts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: p.id }),
    });
    await load();
  }

  const acceptedCount = detail?.proposals.filter((p) => p.accepted).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8" onClick={(e) => e.stopPropagation()}>
        {!detail ? (
          <div className="h-40 animate-pulse rounded-2xl bg-ink/5" />
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-3xl font-medium">{detail.name}</h2>
                  <TierBadge tier={detail.tier} />
                  {detail.status === "inactive" && (
                    <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-[11px] text-ink/50">inactive</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink/55">
                  {[detail.instagram, detail.phone, detail.sorority].filter(Boolean).join(" · ") || "No contact info"}
                </p>
                <p className="mt-1 text-[13px] text-ink/45">
                  Referral code <span className="font-mono font-medium text-ink/70">{detail.referral_code}</span>
                  {detail.join_date && <> · joined {fmtShort(detail.join_date.slice(0, 10))}</>}
                </p>
                {detail.tier === "poster" && detail.active_months.length > 0 && (
                  <p className="mt-1 text-[13px] text-ink/45">Active: {detail.active_months.join(", ")}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => setEditing(!editing)} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/60">
                  {editing ? "Close edit" : "Edit"}
                </button>
                <button onClick={onClose} className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5" aria-label="Close">×</button>
              </div>
            </div>

            {editing && (
              <div className="mb-5 rounded-2xl bg-white p-4">
                <AmbassadorFields
                  name={name} setName={setName} instagram={instagram} setInstagram={setInstagram}
                  phone={phone} setPhone={setPhone} sorority={sorority} setSorority={setSorority}
                  tier={tier} setTier={setTier} status={status} setStatus={setStatus}
                  joinDate={joinDate} setJoinDate={setJoinDate} referralCode={referralCode} setReferralCode={setReferralCode}
                  months={months} toggleMonth={toggleMonth} notes={notes} setNotes={setNotes}
                />
                {error && <p className="mt-3 text-sm text-blush-deep">{error}</p>}
                <button onClick={saveEdit} disabled={busy} className="mt-4 rounded-full bg-ink px-5 py-2.5 text-[15px] text-cream disabled:opacity-40">
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            )}

            {/* Linked records */}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl bg-white p-4">
                <p className={labelCls}>Customer record</p>
                <p className="text-[15px]">{detail.customer_name ?? "—"} <span className="text-ink/40">(rents)</span></p>
              </div>
              <div className="rounded-2xl bg-white p-4">
                <p className={labelCls}>Consignor record</p>
                {detail.consignor_name ? (
                  <p className="text-[15px]">{detail.consignor_name} <span className="text-ink/40">(brings pieces)</span></p>
                ) : (
                  <button onClick={createConsignor} disabled={busy} className="mt-1 rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/60 disabled:opacity-40">
                    + Set up consignor record
                  </button>
                )}
              </div>
            </div>

            {/* Monthly perk credits */}
            <h3 className="mt-6 text-xl font-medium">This month&apos;s credits</h3>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white p-4 text-center">
                <p className="font-serif text-2xl font-semibold">{detail.credits.free}</p>
                <p className="text-[11px] uppercase tracking-[0.15em] text-ink/45">Free left</p>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center">
                <p className="font-serif text-2xl font-semibold">{detail.credits.rate}</p>
                <p className="text-[11px] uppercase tracking-[0.15em] text-ink/45">$6 rate left</p>
              </div>
              <div className="rounded-2xl bg-butter/50 p-4 text-center">
                <p className="font-serif text-2xl font-semibold">{detail.credits.bonus}</p>
                <p className="text-[11px] uppercase tracking-[0.15em] text-ink/45">Bonus left</p>
              </div>
            </div>
            <p className="mt-1.5 text-[12px] text-ink/45">
              Resets on the 1st. Applied automatically at checkout (free → bonus → $6 → full).
            </p>

            {/* Posting */}
            <div className="mt-6 flex items-center justify-between">
              <h3 className="text-xl font-medium">
                Posting · {detail.post_count} of {detail.posting_target} this month
              </h3>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  detail.posting_on_track ? "bg-sage" : "bg-blush"
                }`}
              >
                {detail.posting_on_track ? "On track" : "Behind"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input type="date" className="rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm" value={postDate} onChange={(e) => setPostDate(e.target.value)} />
              <input className={`${inputCls} min-w-40 flex-1`} placeholder="Link (optional)" value={postLink} onChange={(e) => setPostLink(e.target.value)} />
              <input className={`${inputCls} min-w-40 flex-1`} placeholder="Note (optional)" value={postNote} onChange={(e) => setPostNote(e.target.value)} />
              <button onClick={addPost} className="shrink-0 rounded-xl bg-ink px-4 text-[15px] text-cream">Log post</button>
            </div>
            <div className="mt-2 space-y-1.5">
              {detail.posts.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">No posts logged this month.</p>
              ) : (
                detail.posts.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                    <span className="shrink-0 text-[13px] text-ink/55">{fmtShort(p.posted_on.slice(0, 10))}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">
                      {p.link ? (
                        <a href={p.link} target="_blank" rel="noreferrer" className="text-lavender-deep underline underline-offset-2">{p.link}</a>
                      ) : (
                        <span className="text-ink/70">{p.note || "Post"}</span>
                      )}
                      {p.link && p.note && <span className="text-ink/45"> · {p.note}</span>}
                    </span>
                    <button onClick={() => removePost(p)} className="shrink-0 rounded-full px-2 text-lg leading-none text-ink/30 hover:bg-ink/5" aria-label="Remove">×</button>
                  </div>
                ))
              )}
            </div>

            {/* Referrals */}
            <h3 className="mt-6 text-xl font-medium">Referrals ({detail.referral_count})</h3>
            <p className="mt-1 text-[13px] text-ink/45">
              Customers who used code <span className="font-mono">{detail.referral_code}</span> at checkout. (Tracking only — rewards handled manually.)
            </p>
            <div className="mt-2 space-y-1.5">
              {detail.referrals.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">No referrals yet.</p>
              ) : (
                detail.referrals.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-2xl bg-white p-3 text-[15px]">
                    <span>{r.customer_name ?? "Walk-in customer"}</span>
                    <span className="text-[13px] text-ink/45">{fmtShort(r.created_at.slice(0, 10))}</span>
                  </div>
                ))
              )}
            </div>

            {/* Curator proposals */}
            {detail.tier === "curator" && (
              <>
                <h3 className="mt-6 text-xl font-medium">
                  Proposed pieces ({detail.proposals.length}) · {acceptedCount} accepted
                </h3>
                <div className="mt-2 flex gap-2">
                  <input
                    className={inputCls}
                    value={newProposal}
                    onChange={(e) => setNewProposal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProposal(); } }}
                    placeholder="Describe a proposed piece…"
                  />
                  <button onClick={addProposal} className="shrink-0 rounded-xl bg-ink px-4 text-[15px] text-cream">Add</button>
                </div>
                <div className="mt-2 space-y-1.5">
                  {detail.proposals.length === 0 ? (
                    <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">No proposed pieces logged yet.</p>
                  ) : (
                    detail.proposals.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                        <button
                          onClick={() => toggleProposal(p)}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm ${
                            p.accepted ? "border-sage-deep bg-sage text-ink" : "border-ink/20 bg-white text-transparent"
                          }`}
                          aria-label="Toggle accepted"
                        >
                          ✓
                        </button>
                        <span className={`flex-1 text-[15px] ${p.accepted ? "" : "text-ink/70"}`}>{p.description}</span>
                        <span className="shrink-0 text-[12px] text-ink/45">{p.accepted ? "accepted" : "proposed"}</span>
                        <button onClick={() => removeProposal(p)} className="shrink-0 rounded-full px-2 text-lg leading-none text-ink/30 hover:bg-ink/5" aria-label="Remove">×</button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* Sourced pieces */}
            <h3 className="mt-6 text-xl font-medium">Sourced pieces ({detail.sourced_items.length})</h3>
            <div className="mt-2 space-y-2">
              {detail.sourced_items.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">No pieces attributed to this ambassador yet. Tag a piece&apos;s &quot;Sourced by&quot; field in inventory.</p>
              ) : (
                detail.sourced_items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                    <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                      {i.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.photo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">{i.brand.charAt(0)}</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]"><span className="font-serif font-semibold">{i.brand}</span> <span className="text-ink/50 font-mono">{i.barcode || i.id}</span></p>
                      <p className="truncate text-[13px] text-ink/55">{i.size}{i.color ? ` · ${i.color}` : ""} · rented {i.rental_count}×</p>
                    </div>
                    <span className="shrink-0 text-[12px] text-ink/45">{i.status}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AmbassadorsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [fTier, setFTier] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSorority, setFSorority] = useState("");

  async function load() {
    const res = await fetch("/api/ambassadors");
    if (res.ok) setRows(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  const sororities = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.sorority).filter(Boolean))).sort() as string[],
    [rows]
  );

  const list = (rows ?? []).filter((r) => {
    if (fTier && r.tier !== fTier) return false;
    if (fStatus && r.status !== fStatus) return false;
    if (fSorority && r.sorority !== fSorority) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (
      r.name.toLowerCase().includes(t) ||
      (r.instagram ?? "").toLowerCase().includes(t) ||
      (r.referral_code ?? "").toLowerCase().includes(t)
    );
  });

  const hasFilters = q || fTier || fStatus || fSorority;
  const behind = (rows ?? []).filter(
    (r) => r.status === "active" && !r.posting_on_track
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-medium md:text-5xl">Ambassadors</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              {rows?.length ?? "…"} ambassadors · Curators propose pieces, Posters rotate monthly
            </p>
          </div>
          <button onClick={() => setCreating(true)} className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream">+ Add ambassador</button>
        </div>

        {/* Needs attention: active ambassadors behind on posting */}
        {behind.length > 0 && (
          <div className="mt-6 rounded-2xl border border-blush-deep/30 bg-blush/20 p-4">
            <p className="text-sm font-medium">
              Needs attention · {behind.length} behind on posting
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {behind.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="rounded-full bg-white px-3 py-1 text-[13px] hover:bg-white/70"
                >
                  {r.name} · {r.post_count}/{r.posting_target}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mt-6 flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, Instagram, code…"
            className="min-w-44 flex-1 rounded-full border border-ink/15 bg-white px-4.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
          />
          <select value={fTier} onChange={(e) => setFTier(e.target.value)} className="rounded-full border border-ink/15 bg-white px-3.5 py-2.5 text-sm">
            <option value="">Tier</option>
            {AMBASSADOR_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-full border border-ink/15 bg-white px-3.5 py-2.5 text-sm">
            <option value="">Status</option>
            {AMBASSADOR_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={fSorority} onChange={(e) => setFSorority(e.target.value)} className="max-w-40 rounded-full border border-ink/15 bg-white px-3.5 py-2.5 text-sm">
            <option value="">Sorority</option>
            {sororities.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && (
            <button onClick={() => { setQ(""); setFTier(""); setFStatus(""); setFSorority(""); }} className="rounded-full px-3.5 py-2.5 text-sm text-ink/50 underline-offset-2 hover:underline">Clear</button>
          )}
        </div>

        <div className="mt-5 space-y-2">
          {rows === null ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />)
          ) : list.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink/45">
              {rows.length === 0 ? "No ambassadors yet — add your first." : "No one matches those filters."}
            </p>
          ) : (
            list.map((r) => (
              <button key={r.id} onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left transition-colors hover:bg-white/70">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lavender/50 font-serif text-lg italic">{r.name.charAt(0)}</div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[16px]">
                    {r.name}
                    <TierBadge tier={r.tier} />
                    {r.status === "inactive" && <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] text-ink/50">inactive</span>}
                  </p>
                  <p className="truncate text-[13px] text-ink/55">
                    {[r.instagram, r.sorority].filter(Boolean).join(" · ") || "—"} · <span className="font-mono">{r.referral_code}</span>
                  </p>
                </div>
                <span className="shrink-0 text-right text-[13px] text-ink/55">
                  {r.post_count}/{r.posting_target} posts
                  {r.status === "active" && !r.posting_on_track && (
                    <span className="text-blush-deep"> · behind</span>
                  )}
                  <br />
                  {r.referral_count} referral{r.referral_count === 1 ? "" : "s"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={load} />}
      {openId !== null && <DetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </AppShell>
  );
}
