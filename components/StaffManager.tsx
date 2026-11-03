"use client";

import { useCallback, useEffect, useState } from "react";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";

type Staff = {
  id: number;
  name: string;
  username: string;
  role: "admin" | "staff";
  active: boolean;
  created_at: string;
  last_login_at: string | null;
};

// Admin-only: add front-desk logins, and enable/disable each in one click.
export default function StaffManager() {
  const [list, setList] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff");
      if (res.ok) setList(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusyId("new");
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password, role }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't add that login.");
      } else {
        setName("");
        setUsername("");
        setPassword("");
        setRole("staff");
        await load();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    setErr("");
    try {
      const res = await fetch(`/api/staff/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setErr(d.error || "Couldn't update that login.");
      else await load();
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(s: Staff) {
    const pw = window.prompt(`Set a new password for ${s.name} (min 6 characters):`);
    if (pw == null) return;
    if (pw.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    await patch(s.id, { password: pw });
  }

  return (
    <section className="mt-6 rounded-2xl border border-ink/10 bg-white/60 p-5">
      <h2 className="font-serif text-xl italic text-ink/70">Staff logins</h2>
      <p className="mt-1 text-[13px] text-ink/50">
        Each front-desk person gets their own login. Disable one in a click when
        they leave — it takes effect immediately.
      </p>

      {/* Existing logins */}
      <div className="mt-4 space-y-2">
        {!loaded ? (
          <div className="h-16 animate-pulse rounded-xl bg-ink/5" />
        ) : list.length === 0 ? (
          <p className="rounded-xl bg-white p-3 text-sm text-ink/45">
            No staff logins yet — add one below.
          </p>
        ) : (
          list.map((s) => (
            <div
              key={s.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-ink/10 bg-white p-3 ${
                s.active ? "" : "opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">
                  {s.name}{" "}
                  <span className="text-ink/45">@{s.username}</span>
                  {s.role === "admin" && (
                    <span className="ml-2 rounded-full bg-lavender/50 px-2 py-0.5 text-[11px] text-ink/60">
                      Admin
                    </span>
                  )}
                  {!s.active && (
                    <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] text-ink/50">
                      Disabled
                    </span>
                  )}
                </p>
                <p className="text-[12px] text-ink/45">
                  {s.last_login_at
                    ? `Last sign-in ${new Date(s.last_login_at).toLocaleDateString()}`
                    : "Never signed in"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => patch(s.id, { active: !s.active })}
                  disabled={busyId === s.id}
                  className={`rounded-full px-3 py-1.5 text-[12px] disabled:opacity-40 ${
                    s.active
                      ? "border border-ink/20 text-ink/60"
                      : "bg-ink text-cream"
                  }`}
                >
                  {busyId === s.id ? "…" : s.active ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => resetPassword(s)}
                  disabled={busyId === s.id}
                  className="rounded-full px-3 py-1.5 text-[12px] text-ink/50 hover:bg-ink/5 disabled:opacity-40"
                >
                  Reset password
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add a login */}
      <form onSubmit={create} className="mt-4 rounded-xl border border-dashed border-ink/20 p-4">
        <p className="text-[13px] font-medium text-ink/70">Add a staff login</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Username</label>
            <input
              className={inputCls}
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Temporary password</label>
            <input
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value as "staff" | "admin")}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin (sees everything)</option>
            </select>
          </div>
        </div>
        {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}
        <button
          type="submit"
          disabled={busyId === "new" || !name || !username || !password}
          className="mt-3 rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40"
        >
          {busyId === "new" ? "Adding…" : "Add login"}
        </button>
      </form>
    </section>
  );
}
