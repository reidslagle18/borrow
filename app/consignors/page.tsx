"use client";

import { useEffect, useState } from "react";
import { useMe } from "@/lib/useMe";
import AppShell from "@/components/AppShell";
import ConsignorAgreementModal from "@/components/ConsignorAgreementModal";
import {
  Item,
  Consignor,
  Payout,
  ConsignorCharge,
  statusLabel,
  ItemStatus,
  CONSIGNOR_AGREEMENT_INTRO,
  CONSIGNOR_AGREEMENT_BODY,
} from "@/lib/types";
import { fmtShort, dateOnly } from "@/lib/dates";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type ConsignorRow = Consignor & {
  piece_count: number;
  active_piece_count: number;
  pending_approvals?: number;
  earned: number;
  paid: number;
  owed: number;
  portal_code?: string | null;
  created_at?: string | null;
};

type SortKey = "created" | "name" | "earned" | "owed";
// Natural direction for each column when you first click it.
const SORT_DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = {
  created: "desc", // newest first — the default view
  name: "asc",
  earned: "desc",
  owed: "desc",
};
const SORT_LABEL: Record<SortKey, string> = {
  created: "Newest",
  name: "Name",
  earned: "Earned",
  owed: "Owed",
};

type ConsignorDetail = ConsignorRow & {
  rate?: number; // locked commission % (60 / 50 / 40 depending on when they came in)
  rate_basis?: string; // "appointment booking" | "agreement signing" | "new default"
  rate_basis_date?: string | null;
  rate_locked?: boolean;
  items: (Item & { completed_rentals: number; earned: number })[];
  payouts: (Payout & { status?: string; auto?: boolean })[];
  charges: ConsignorCharge[];
  cleaning_charges: number;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  welcome_sent_at: string | null;
  approval_email_sent_at?: string | null;
};

const STATUS_BADGE: Record<ItemStatus, string> = {
  available: "bg-sage",
  reserved: "bg-lavender",
  rented: "bg-blush",
  consignor_hold: "bg-blush-deep/25",
  cleaning: "bg-butter",
  retired: "bg-ink/10 text-ink/60",
  with_consignor: "bg-lavender-deep/30 text-ink",
  in_storage: "bg-ink/10 text-ink/60",
};

function money(n: number | string): string {
  const v = Number(n);
  return `$${v % 1 === 0 ? v : v.toFixed(2)}`;
}

function ConsignorForm({
  consignor,
  onClose,
  onSaved,
}: {
  consignor: Consignor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(consignor?.name ?? "");
  const [phone, setPhone] = useState(consignor?.phone ?? "");
  const [email, setEmail] = useState(consignor?.email ?? "");
  const [notes, setNotes] = useState(consignor?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    const res = await fetch(
      consignor ? `/api/consignors/${consignor.id}` : "/api/consignors",
      {
        method: consignor ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          notes: notes.trim(),
        }),
      }
    );
    if (res.ok) {
      onSaved();
    } else {
      setError("Couldn't save — try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-3xl font-medium">
          {consignor ? "Edit consignor" : "New consignor"}
        </h2>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Drop-off habits, anything useful…" />
          </div>
          {!consignor && (
            <p className="rounded-2xl bg-lavender/25 px-3.5 py-3 text-[13px] text-ink/60">
              On save, we create their consignor account. Nothing is emailed
              automatically — when they come in, open their card and click{" "}
              <span className="font-medium">Send setup email</span> to send their
              personal payout-setup link.
            </p>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-blush-deep">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-full bg-ink px-6 py-3 text-cream disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="rounded-full border border-ink/15 px-5 py-3 text-ink/50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { me } = useMe();
  const isAdmin = me?.role === "admin";
  const [detail, setDetail] = useState<ConsignorDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [confirmReturn, setConfirmReturn] = useState<string | null>(null);
  const [dryClean, setDryClean] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState("");

  async function notifyApproval(force = false) {
    setNotifyBusy(true);
    setNotifyMsg("");
    const res = await fetch(`/api/consignors/${id}/notify-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const d = await res.json().catch(() => ({}));
    // Guard: warn if we emailed them very recently, unless confirmed.
    if (res.status === 409 && d.already_sent_recently) {
      setNotifyBusy(false);
      if (
        window.confirm(
          "You already emailed this consignor recently. Send another email anyway?"
        )
      ) {
        return notifyApproval(true);
      }
      setNotifyMsg("No email sent — you already emailed them recently.");
      return;
    }
    setNotifyMsg(res.ok ? "Sent — they'll get an email listing every item with a link to approve." : d.error || "Couldn't send.");
    setNotifyBusy(false);
    if (res.ok) {
      await load();
      onChanged();
    }
  }

  // Resolve a disputed piece: accept the consignor's suggested value or keep ours.
  async function resolveDispute(
    itemId: string,
    action: "accept_suggested" | "reject_suggested"
  ) {
    setBusyItem(itemId);
    await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approval", approval_action: action }),
    });
    await load();
    onChanged();
    setBusyItem(null);
  }
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [connectUrl, setConnectUrl] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectMsg, setConnectMsg] = useState("");
  const [copied, setCopied] = useState(false);

  async function getConnectLink() {
    setConnectBusy(true);
    setConnectMsg("");
    const res = await fetch("/api/stripe/connect/onboard-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consignor_id: id }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.url) setConnectUrl(d.url);
    else setConnectMsg(d.error || "Couldn't create a link — is Stripe Connect turned on?");
    setConnectBusy(false);
  }

  async function remove() {
    const res = await fetch(`/api/consignors/${id}`, { method: "DELETE" });
    if (res.ok) {
      onChanged();
      onClose();
    } else {
      const d = await res.json().catch(() => ({}));
      setDeleteError(d.error || "Couldn't delete this consignor.");
      setConfirmingDelete(false);
    }
  }

  async function load() {
    try {
      const res = await fetch(`/api/consignors/${id}`);
      if (res.ok) setDetail(await res.json());
      else setLoadFailed(true);
    } catch {
      setLoadFailed(true);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // One action: release everything owed to their Stripe connected account.
  async function payNow() {
    setPaying(true);
    setPayMsg("");
    const res = await fetch(`/api/consignors/${id}/pay`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      await load();
      onChanged();
      setPayMsg("Payout sent to their bank.");
    } else {
      setPayMsg(d.error || "Couldn't pay — try again.");
    }
    setPaying(false);
  }

  async function sendWelcome() {
    setWelcomeBusy(true);
    setWelcomeMsg("");
    const res = await fetch(`/api/consignors/${id}/welcome`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.sent) await load();
    setWelcomeMsg(
      res.ok
        ? d.sent
          ? "Setup email sent with their payout-setup link."
          : "Couldn't send (add an email, or email isn't configured)."
        : d.error || "Couldn't send."
    );
    setWelcomeBusy(false);
  }

  async function consignorAction(itemId: string, action: string) {
    setBusyItem(itemId);
    const res = await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      await load();
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Couldn't update this piece.");
    }
    setBusyItem(null);
  }

  async function returnPiece(itemId: string) {
    setBusyItem(itemId);
    const res = await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return_to_consignor", dry_clean: dryClean }),
    });
    if (res.ok) {
      await load();
      onChanged();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Couldn't return this piece.");
    }
    setBusyItem(null);
    setConfirmReturn(null);
    setDryClean(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-cream p-6 sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {loadFailed && !detail ? (
          <p className="rounded-2xl bg-blush/25 p-5 text-sm text-ink/70">
            Couldn&apos;t load this consignor — close and try again.
          </p>
        ) : !detail ? (
          <div className="h-40 animate-pulse rounded-2xl bg-ink/5" />
        ) : (
          <>
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-medium">{detail.name}</h2>
                <p className="mt-1 text-sm text-ink/55">
                  {[detail.phone, detail.email].filter(Boolean).join(" · ") ||
                    "No contact info"}
                </p>
                {detail.notes && (
                  <p className="mt-1 text-sm text-ink/45">{detail.notes}</p>
                )}
                {detail.portal_code && (
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(
                        `Check on your BORROW pieces anytime: borrow-shop.vercel.app/portal — your access code is ${detail.portal_code}`
                      )
                    }
                    className="mt-2 rounded-full bg-lavender/50 px-3 py-1.5 text-[12px] tracking-wide"
                    title="Tap to copy an invite message"
                  >
                    Portal code: <span className="font-medium">{detail.portal_code}</span> · tap to copy invite
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {isAdmin && (
                  <button
                    onClick={() => setEditOpen(true)}
                    className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/60"
                  >
                    Edit
                  </button>
                )}
                {isAdmin &&
                  (confirmingDelete ? (
                    <button
                      onClick={remove}
                      className="rounded-full border border-blush-deep px-3 py-1.5 text-sm text-blush-deep"
                    >
                      Really delete?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/40"
                    >
                      Delete
                    </button>
                  ))}
                <button
                  onClick={onClose}
                  className="rounded-full px-3 py-1 text-2xl leading-none text-ink/40 hover:bg-ink/5"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            {deleteError && (
              <p className="mb-3 rounded-2xl bg-blush/25 px-4 py-2.5 text-sm text-ink/70">
                {deleteError}
              </p>
            )}

            {/* Disputed pieces — needs the admin's decision (surfaced first) */}
            {isAdmin && (() => {
              const disputed = detail.items.filter(
                (i) => i.approval_status === "disputed"
              );
              if (disputed.length === 0) return null;
              return (
                <div className="mb-4 rounded-2xl border border-blush-deep/40 bg-blush/30 p-4">
                  <p className="font-medium">
                    {disputed.length} disputed value
                    {disputed.length === 1 ? "" : "s"} — needs your decision
                  </p>
                  <div className="mt-3 space-y-3">
                    {disputed.map((i) => (
                      <div key={i.id} className="rounded-xl bg-white p-3">
                        <p className="font-medium">{i.name || i.brand}</p>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px]">
                          <span>
                            Your value:{" "}
                            <strong>{money(i.replacement_value ?? 0)}</strong>
                          </span>
                          <span>
                            They suggest:{" "}
                            <strong>{money(i.disputed_value ?? 0)}</strong>
                          </span>
                        </div>
                        {i.dispute_note && (
                          <p className="mt-1 text-[13px] italic text-ink/60">
                            “{i.dispute_note}”
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            onClick={() => resolveDispute(i.id, "accept_suggested")}
                            disabled={busyItem === i.id}
                            className="rounded-full bg-ink px-4 py-1.5 text-sm text-cream disabled:opacity-40"
                          >
                            Approve their {money(i.disputed_value ?? 0)}
                          </button>
                          <button
                            onClick={() => resolveDispute(i.id, "reject_suggested")}
                            disabled={busyItem === i.id}
                            className="rounded-full border border-ink/15 px-4 py-1.5 text-sm text-ink/60 disabled:opacity-40"
                          >
                            Reject, keep {money(i.replacement_value ?? 0)}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-ink/55">
                    Either choice sends the piece back to the consignor for a final
                    sign-off.
                  </p>
                </div>
              );
            })()}

            {/* Awaiting consignor approval — blocks the whole batch from going live */}
            {(() => {
              const pending = detail.items.filter(
                (i) => i.approval_status === "pending"
              );
              if (pending.length === 0) return null;
              return (
                <div className="mb-4 rounded-2xl border border-butter-deep/40 bg-butter/50 p-4">
                  <p className="font-medium">
                    {pending.length} item{pending.length === 1 ? "" : "s"} awaiting
                    consignor approval
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink/60">
                    None of this consignor&apos;s pieces can go live until every one
                    is approved.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pending.map((i) => (
                      <span
                        key={i.id}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px]"
                        title={
                          i.approval_notified_at
                            ? `Emailed ${new Date(i.approval_notified_at).toLocaleString()}`
                            : "Not emailed yet — the batched email goes out once the window closes"
                        }
                      >
                        <span
                          className={
                            i.approval_notified_at ? "text-sage-deep" : "text-ink/30"
                          }
                        >
                          {i.approval_notified_at ? "✓" : "◦"}
                        </span>
                        {i.name || i.brand}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-ink/50">
                    {detail.approval_email_sent_at
                      ? `Last emailed to approve: ${new Date(detail.approval_email_sent_at).toLocaleString()}.`
                      : "Not emailed yet."}{" "}
                    New pieces are batched into one email automatically; ✓ marks a
                    piece the consignor has already been emailed about.
                  </p>
                  <button
                    onClick={() => notifyApproval()}
                    disabled={notifyBusy}
                    className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-cream disabled:opacity-40"
                  >
                    {notifyBusy ? "Sending…" : "Re-send “your items are ready” email"}
                  </button>
                  {notifyMsg && (
                    <p className="mt-2 text-[13px] text-ink/60">{notifyMsg}</p>
                  )}
                </div>
              );
            })()}

            {/* Money summary */}
            {isAdmin && (
            <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white p-3.5 text-center">
                <p className="text-xs uppercase tracking-[0.15em] text-ink/45">Earned ({detail.rate ?? 60}%)</p>
                <p className="mt-1 font-serif text-2xl font-semibold">{money(detail.earned)}</p>
              </div>
              <div className="rounded-2xl bg-white p-3.5 text-center">
                <p className="text-xs uppercase tracking-[0.15em] text-ink/45">Paid out</p>
                <p className="mt-1 font-serif text-2xl font-semibold">{money(detail.paid)}</p>
              </div>
              <div className={`rounded-2xl p-3.5 text-center ${detail.owed > 0 ? "bg-butter" : "bg-white"}`}>
                <p className="text-xs uppercase tracking-[0.15em] text-ink/45">Owed</p>
                <p className="mt-1 font-serif text-2xl font-semibold">{money(detail.owed)}</p>
              </div>
            </div>
            {/* Why this consignor is at their rate (item 7) */}
            <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-[12px] text-ink/60">
              <span className="font-semibold text-ink">{detail.rate ?? 60}% consignor split</span>
              {" · "}
              {detail.rate_locked ? "locked" : "not locked yet"}
              {detail.rate_basis
                ? ` at ${detail.rate_basis}${
                    detail.rate_basis_date
                      ? ` on ${fmtShort(dateOnly(detail.rate_basis_date))}`
                      : ""
                  }`
                : ""}
            </p>
            {detail.cleaning_charges > 0 && (
              <p className="mt-1.5 text-[12px] text-ink/45">
                Includes {money(detail.cleaning_charges)} in opt-in cleaning charges deducted from earnings.
              </p>
            )}
            </>
            )}

            {/* Direct deposit (Stripe Connect) */}
            {isAdmin && (
            <>
            <div className="mt-4 rounded-2xl bg-white p-4">
              <div className="flex items-center justify-between">
                <p className={`${labelCls} mb-0`}>Direct deposit</p>
                {detail.payouts_enabled ? (
                  <span className="rounded-full bg-sage px-2.5 py-1 text-[11px]">Set up ✓</span>
                ) : detail.stripe_account_id ? (
                  <span className="rounded-full bg-butter px-2.5 py-1 text-[11px]">Onboarding pending</span>
                ) : (
                  <span className="rounded-full bg-ink/10 px-2.5 py-1 text-[11px] text-ink/60">Not started</span>
                )}
              </div>
              <p className="mt-1.5 text-[13px] text-ink/55">
                {detail.payouts_enabled
                  ? "Bank added & verified — you can pay them directly below."
                  : "They add their bank & verify identity through Stripe. Earnings still accrue below; they just can't be paid until this is done."}
              </p>
              <p className="mt-1.5 text-[12px] text-ink/45">
                {detail.welcome_sent_at
                  ? `Setup email sent ${fmtShort(dateOnly(detail.welcome_sent_at))}.`
                  : "Setup email not sent yet — send it when they come in."}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  onClick={sendWelcome}
                  disabled={welcomeBusy}
                  className={`rounded-full px-4 py-2 text-[13px] disabled:opacity-40 ${
                    detail.welcome_sent_at
                      ? "border border-ink/15 text-ink/70"
                      : "bg-ink text-cream"
                  }`}
                >
                  {welcomeBusy
                    ? "Sending…"
                    : detail.welcome_sent_at
                      ? "Resend setup email"
                      : "Send setup email"}
                </button>
                {!detail.payouts_enabled &&
                  (connectUrl ? (
                    <>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(connectUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream"
                      >
                        {copied ? "Copied ✓" : "Copy setup link"}
                      </button>
                      <a
                        href={connectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-ink/15 px-4 py-2 text-[13px] text-ink/60"
                      >
                        Open
                      </a>
                    </>
                  ) : (
                    <button
                      onClick={getConnectLink}
                      disabled={connectBusy}
                      className="rounded-full border border-ink/15 px-4 py-2 text-[13px] text-ink/70 disabled:opacity-40"
                    >
                      {connectBusy ? "Creating link…" : "Get setup link"}
                    </button>
                  ))}
              </div>
              {welcomeMsg && <p className="mt-2 text-[13px] text-ink/60">{welcomeMsg}</p>}
              {connectMsg && <p className="mt-2 text-[13px] text-blush-deep">{connectMsg}</p>}
            </div>

            {/* Pay out (one action) */}
            <div className="mt-4 rounded-2xl bg-lavender/25 p-4">
              <div className="flex items-center justify-between">
                <p className={`${labelCls} mb-0`}>Pay out</p>
                <span className="text-[15px] font-semibold">{money(detail.owed)} owed</span>
              </div>
              {detail.owed > 0 ? (
                detail.payouts_enabled ? (
                  <button
                    onClick={payNow}
                    disabled={paying}
                    className="mt-3 w-full rounded-full bg-ink px-5 py-3 text-[15px] text-cream disabled:opacity-40"
                  >
                    {paying ? "Sending…" : `Pay ${money(detail.owed)} to their bank`}
                  </button>
                ) : (
                  <p className="mt-2 rounded-xl bg-butter/50 px-3.5 py-2.5 text-[13px] text-ink/70">
                    {money(detail.owed)} is owed and accruing, but they can&apos;t
                    be paid until they finish direct-deposit setup above.
                  </p>
                )
              ) : (
                <p className="mt-2 text-[13px] text-ink/50">All paid up.</p>
              )}
              {payMsg && <p className="mt-2 text-[13px] text-sage-deep">{payMsg}</p>}
            </div>
            </>
            )}

            {/* Pieces */}
            <h3 className="mt-6 text-xl font-medium">
              Pieces ({detail.items.length})
            </h3>
            <div className="mt-2 space-y-2">
              {detail.items.length === 0 ? (
                <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                  No pieces from this consignor yet.
                </p>
              ) : (
                detail.items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 rounded-2xl bg-white p-3">
                    <div className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
                      {i.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.photo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center font-serif italic text-ink/30">
                          {(i.name || i.brand).charAt(0)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px]">
                        <span className="font-serif font-semibold">{i.name || i.brand}</span>{" "}
                        <span className="text-ink/50">{i.id} · {i.size}</span>
                      </p>
                      <p className="truncate text-[13px] text-ink/55">
                        rented {i.completed_rentals}×
                        {isAdmin && ` · earned ${money(i.earned)}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${STATUS_BADGE[i.status]}`}>
                      {statusLabel(i.status)}
                    </span>
                    {i.status !== "retired" &&
                      (confirmReturn === i.id ? (
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <label className="flex items-center gap-1.5 text-[12px] text-ink/60">
                            <input
                              type="checkbox"
                              checked={dryClean}
                              onChange={(e) => setDryClean(e.target.checked)}
                              className="h-3.5 w-3.5 accent-ink"
                            />
                            Dry clean — consignor opted in (deducts the cleaning fee from earnings)
                          </label>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => returnPiece(i.id)}
                              disabled={busyItem === i.id}
                              className="rounded-full border border-blush-deep px-3 py-1.5 text-[12px] text-blush-deep disabled:opacity-40"
                            >
                              Confirm return
                            </button>
                            <button
                              onClick={() => {
                                setConfirmReturn(null);
                                setDryClean(false);
                              }}
                              className="rounded-full px-3 py-1.5 text-[12px] text-ink/40"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : i.status === "with_consignor" ? (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <button
                            onClick={() => consignorAction(i.id, "consignor_return")}
                            disabled={busyItem === i.id}
                            className="rounded-full border border-sage-deep px-3 py-1.5 text-[12px] text-ink/70 disabled:opacity-40"
                          >
                            Mark returned
                          </button>
                          <span className="text-[11px] text-ink/40">must come back clean</span>
                        </div>
                      ) : (
                        <div className="flex shrink-0 gap-1.5">
                          {(i.status === "available" ||
                            i.status === "reserved" ||
                            i.status === "cleaning") && (
                            <button
                              onClick={() => consignorAction(i.id, "consignor_take")}
                              disabled={busyItem === i.id}
                              className="rounded-full border border-ink/15 px-3 py-1.5 text-[12px] text-ink/50 disabled:opacity-40"
                              title="Consignor borrows their own piece (free, returned clean)"
                            >
                              Lend to her
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmReturn(i.id)}
                            className="rounded-full border border-ink/15 px-3 py-1.5 text-[12px] text-ink/50"
                          >
                            Return to her
                          </button>
                        </div>
                      ))}
                  </div>
                ))
              )}
            </div>

            {/* Payout history */}
            {isAdmin && detail.payouts.length > 0 && (
              <>
                <h3 className="mt-6 text-xl font-medium">Payout history</h3>
                <div className="mt-2 space-y-1.5">
                  {detail.payouts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-2.5 text-[14px]">
                      <span>
                        {money(p.amount)}
                        {p.method && <span className="text-ink/50"> · {p.method}</span>}
                        {p.status === "pending" && (
                          <span className="ml-2 rounded-full bg-butter px-2 py-0.5 text-[11px]">queued</span>
                        )}
                      </span>
                      <span className="text-ink/45">
                        {p.status === "pending" ? "waiting to send" : fmtShort(dateOnly(p.paid_at))}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Cleaning charges (opt-in) */}
            {isAdmin && detail.charges.length > 0 && (
              <>
                <h3 className="mt-6 text-xl font-medium">Cleaning charges</h3>
                <div className="mt-2 space-y-1.5">
                  {detail.charges.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-xl bg-white/70 px-4 py-2.5 text-[14px]">
                      <span>
                        −{money(c.amount)}
                        <span className="text-ink/50">
                          {" "}·{" "}
                          {c.note?.toLowerCase().includes("self-hold")
                            ? "cleaning fee — self-hold return"
                            : c.kind === "retrieval"
                              ? "dry clean at retrieval"
                              : "initial clean"}
                        </span>
                      </span>
                      <span className="text-ink/45">{fmtShort(dateOnly(c.charged_on))}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Consignor agreement (signed digital record) */}
            <div className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-xl font-medium">Consignor agreement</h3>
                {detail.agreement_signed_at ? (
                  <span className="shrink-0 rounded-full bg-sage px-3 py-1 text-[12px]">
                    Signed
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSignOpen(true)}
                    className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-sm text-cream"
                  >
                    Capture signature
                  </button>
                )}
              </div>
              {detail.agreement_signed_at ? (
                <p className="mt-2 text-[13px] text-ink/60">
                  Signed by <strong>{detail.agreement_signed_name}</strong> on{" "}
                  {new Date(detail.agreement_signed_at).toLocaleString()}
                  {detail.agreement_signed_ip
                    ? ` · IP ${detail.agreement_signed_ip}`
                    : ""}
                  .
                </p>
              ) : (
                <p className="mt-2 text-[13px] text-blush-deep">
                  Not signed yet. Their pieces can&apos;t be listed as Available
                  until this signature is on file.
                </p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] text-ink/50">
                  View agreement text
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-ink/60">
                  {CONSIGNOR_AGREEMENT_INTRO}
                </p>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink/60">
                  {CONSIGNOR_AGREEMENT_BODY.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </details>
            </div>
          </>
        )}
      </div>

      {editOpen && detail && (
        <ConsignorForm
          consignor={detail}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            load();
            onChanged();
          }}
        />
      )}

      {signOpen && detail && (
        <ConsignorAgreementModal
          consignorId={detail.id}
          consignorName={detail.name}
          onClose={() => setSignOpen(false)}
          onSigned={() => {
            setSignOpen(false);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export default function ConsignorsPage() {
  const { me } = useMe();
  const isAdmin = me?.role === "admin";
  const [consignors, setConsignors] = useState<ConsignorRow[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  // Default view: most recently added first. Clicking a header re-sorts.
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function sortBy(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(SORT_DEFAULT_DIR[k]);
    }
  }

  const [loadError, setLoadError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/consignors");
      if (res.ok) setConsignors(await res.json());
      else setLoadError("Couldn't load consignors — refresh to try again.");
    } catch {
      setLoadError("Couldn't load consignors — check your connection and refresh.");
    }
  }
  useEffect(() => {
    load();
    // Deep link: /consignors?open=ID (from global search / notifications).
    const openParam = new URLSearchParams(window.location.search).get("open");
    if (openParam) setOpenId(Number(openParam));
  }, []);

  // Staff never see Earned/Owed; if one of those is the active sort, fall back
  // to the safe default so the list still renders sensibly.
  const effectiveSortKey: SortKey =
    !isAdmin && (sortKey === "earned" || sortKey === "owed") ? "created" : sortKey;

  const list = (consignors ?? [])
    .filter((c) => {
      const t = q.trim().toLowerCase();
      if (!t) return true;
      return (
        c.name.toLowerCase().includes(t) ||
        (c.phone ?? "").replace(/\D/g, "").includes(t.replace(/\D/g, "") || " ")
      );
    })
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      let cmp = 0;
      if (effectiveSortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (effectiveSortKey === "earned") cmp = a.earned - b.earned;
      else if (effectiveSortKey === "owed") cmp = a.owed - b.owed;
      else cmp = (a.created_at ?? "").localeCompare(b.created_at ?? ""); // created
      // Stable tiebreak so equal values keep a consistent (newest-first) order.
      if (cmp === 0) cmp = (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id - b.id;
      return cmp * dir;
    });
  const totalOwed = (consignors ?? []).reduce((s, c) => s + c.owed, 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-10 md:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl font-medium md:text-5xl">Consignors</h1>
            <p className="mt-1.5 text-sm text-ink/50">
              {consignors?.length ?? "…"} consignors
              {isAdmin && totalOwed > 0 && ` · ${money(totalOwed)} owed in payouts`}
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setAddOpen(true)}
              className="rounded-full bg-ink px-6 py-3 text-[15px] text-cream transition-transform active:scale-[0.98]"
            >
              + Add consignor
            </button>
          )}
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or phone…"
          className="mt-6 w-full max-w-sm rounded-full border border-ink/15 bg-white px-4.5 py-2.5 text-[15px] outline-none focus:border-ink/40"
        />

        {/* Sort controls — click a column to re-sort; newest-first is default. */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink/45">Sort by</span>
          {((isAdmin
            ? ["created", "name", "earned", "owed"]
            : ["created", "name"]) as SortKey[]).map((k) => {
            const active = effectiveSortKey === k;
            return (
              <button
                key={k}
                onClick={() => sortBy(k)}
                className={`rounded-full px-3 py-1 transition-colors ${
                  active
                    ? "bg-ink text-cream"
                    : "bg-white text-ink/60 hover:bg-white/70"
                }`}
              >
                {SORT_LABEL[k]}
                {active && (
                  <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-2">
          {loadError && consignors === null ? (
            <p className="rounded-2xl bg-blush/25 p-5 text-sm text-ink/70">{loadError}</p>
          ) : consignors === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-ink/5" />
            ))
          ) : list.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-sm text-ink/45">
              {consignors.length === 0
                ? "No consignors yet — add the first one."
                : "No one matches that search."}
            </p>
          ) : (
            list.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left transition-colors hover:bg-white/70"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blush/40 font-serif text-lg italic">
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px]">{c.name}</p>
                  <p className="truncate text-[13px] text-ink/55">
                    {c.active_piece_count} piece{c.active_piece_count === 1 ? "" : "s"} on the rack
                    {c.phone ? ` · ${c.phone}` : ""}
                  </p>
                  {!!c.pending_approvals && c.pending_approvals > 0 && (
                    <span className="mt-1 inline-block rounded-full bg-butter px-2.5 py-0.5 text-[12px] font-medium">
                      {c.pending_approvals} awaiting approval
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <div className="shrink-0 text-right">
                    <p className="text-[15px]">{money(c.earned)} earned</p>
                    {c.owed > 0 ? (
                      <span className="mt-0.5 inline-block rounded-full bg-butter px-2.5 py-0.5 text-[12px] font-medium">
                        {money(c.owed)} owed
                      </span>
                    ) : (
                      <p className="text-[12px] text-ink/45">paid up</p>
                    )}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {openId !== null && (
        <DetailModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />
      )}
      {addOpen && (
        <ConsignorForm
          consignor={null}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            load();
          }}
        />
      )}
    </AppShell>
  );
}
