"use client";

import { useState } from "react";
import type { Me } from "@/lib/useMe";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

// "My account" — every signed-in person can change their own password here.
// The owner (APP_PASSWORD login) has no stored password to change.
export default function AccountCard({ me }: { me: Me | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const isOwner = me?.userId == null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    if (next !== confirm) {
      setErr("The new passwords don't match.");
      return;
    }
    if (next.length < 6) {
      setErr("New password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg("Password changed ✓");
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setErr(d.error || "Couldn't change your password.");
      }
    } catch {
      setErr("Couldn't reach the studio — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-ink/10 bg-white/60 p-5">
      <h2 className="font-serif text-xl italic text-ink/70">My account</h2>
      <p className="mt-1 text-[13px] text-ink/50">
        Signed in as <span className="font-medium text-ink/70">{me?.name ?? "…"}</span>
        {me ? (me.isAdmin ? " · Admin" : " · Staff") : ""}
      </p>

      {isOwner ? (
        <p className="mt-3 rounded-xl bg-ink/5 px-3.5 py-3 text-[13px] text-ink/55">
          You&apos;re signed in with the owner password, which is set by the
          <span className="font-mono"> APP_PASSWORD</span> environment variable and
          can&apos;t be changed here.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 max-w-sm space-y-3">
          <div>
            <label className={labelCls}>Current password</label>
            <input
              type="password"
              className={inputCls}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className={labelCls}>New password</label>
            <input
              type="password"
              className={inputCls}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className={labelCls}>Confirm new password</label>
            <input
              type="password"
              className={inputCls}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {err && <p className="text-sm text-blush-deep">{err}</p>}
          {msg && <p className="text-sm text-sage-deep">{msg}</p>}
          <button
            type="submit"
            disabled={busy || !current || !next}
            className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
          >
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      )}
    </section>
  );
}
