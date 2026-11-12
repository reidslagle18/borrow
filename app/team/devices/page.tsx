"use client";

import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useMe } from "@/lib/useMe";
import { fmtDateTime } from "@/lib/timeclock-shared";

const inputCls =
  "w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-ink/40";
const labelCls = "mb-1.5 block text-xs uppercase tracking-[0.15em] text-ink/50";
const primaryBtn =
  "rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream disabled:opacity-40";
const outlineBtn = "rounded-full border border-ink/15 px-4 py-2 text-[13px]";

type Device = {
  id: number;
  name: string;
  active: boolean;
  registered: boolean;
  registered_at: string | null;
  last_seen_at: string | null;
  setup_code: string | null;
  code_expires_at: string | null;
};

export default function DevicesPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.role === "admin";
  const [devices, setDevices] = useState<Device[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("Store iPad");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/team/devices");
      if (!res.ok) throw new Error(`devices ${res.status}`);
      setDevices(await res.json());
      setLoaded(true);
    } catch {
      setLoadError("Couldn't load devices — refresh to try again.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function addDevice(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch("/api/team/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(d.error || "Couldn't add that device.");
      } else {
        setNewCode(d.setup_code ?? null);
        setName("Store iPad");
        await load();
      }
    } catch {
      setAddError("Couldn't reach the studio — try again.");
    } finally {
      setAdding(false);
    }
  }

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
        <h1 className="font-serif text-4xl font-medium md:text-5xl">Clock devices</h1>
        <p className="mt-1.5 text-sm text-ink/50">
          The iPads your staff clock in and out on.
        </p>

        <div className="mt-6 rounded-2xl bg-white p-4">
          <h2 className="font-serif text-xl italic text-ink/70">How this works</h2>
          <p className="mt-2 text-[14px] text-ink/60">
            Register the store iPad once. Add a device here to get a one-time code,
            then open this site on the iPad, go to the Clock page, and enter the code.
            Only registered devices can clock staff in/out.
          </p>
        </div>

        <form onSubmit={addDevice} className="mt-6 rounded-2xl bg-white p-4">
          <h2 className="font-serif text-xl italic text-ink/70">Add device</h2>
          <div className="mt-3 max-w-sm">
            <label className={labelCls}>Device name</label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {addError && <p className="mt-2 text-sm text-blush-deep">{addError}</p>}
          <button
            type="submit"
            disabled={adding || !name.trim()}
            className={`mt-3 ${primaryBtn}`}
          >
            {adding ? "Adding…" : "Add device"}
          </button>

          {newCode && (
            <div className="mt-4 rounded-2xl bg-butter p-5">
              <p className="text-[13px] uppercase tracking-[0.15em] text-ink/60">
                Enter this on the iPad
              </p>
              <p className="mt-1 font-serif text-4xl font-medium tracking-widest">
                {newCode}
              </p>
            </div>
          )}
        </form>

        {loadError ? (
          <p className="mt-16 text-center text-ink/50">{loadError}</p>
        ) : !loaded ? (
          <div className="mt-8 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/5" />
            ))}
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {devices.length === 0 ? (
              <p className="rounded-2xl bg-white p-4 text-sm text-ink/45">
                No devices yet. Add one above to get a setup code.
              </p>
            ) : (
              devices.map((d) => (
                <DeviceCard key={d.id} device={d} onChange={load} />
              ))
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function DeviceCard({
  device,
  onChange,
}: {
  device: Device;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [code, setCode] = useState<string | null>(device.setup_code);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/team/devices/${device.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error || "Couldn't save that change.");
        return null;
      }
      await onChange();
      return d;
    } catch {
      setErr("Couldn't reach the studio — try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    const d = await patch({ regenerate: true });
    if (d && d.setup_code) setCode(d.setup_code);
  }

  const awaiting = !device.registered && device.active;

  return (
    <div className={`rounded-2xl bg-white p-4 ${device.active ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-bold">{device.name}</span>
            {!device.active ? (
              <span className="rounded-full bg-blush-deep px-3 py-1 text-[12px] text-cream">
                Inactive
              </span>
            ) : device.registered ? (
              <span className="rounded-full bg-sage/50 px-3 py-1 text-[12px] text-ink/70">
                Registered
              </span>
            ) : (
              <span className="rounded-full bg-butter px-3 py-1 text-[12px] text-ink/70">
                Awaiting setup
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-ink/55">
            Last seen: {device.last_seen_at ? fmtDateTime(device.last_seen_at) : "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {device.active ? (
            <button
              onClick={() => patch({ active: false })}
              disabled={busy}
              className={outlineBtn}
            >
              Deactivate
            </button>
          ) : (
            <button
              onClick={() => patch({ active: true })}
              disabled={busy}
              className={primaryBtn}
            >
              Reactivate
            </button>
          )}
        </div>
      </div>

      {awaiting && (
        <div className="mt-3 rounded-xl bg-cream/60 p-3">
          {code && (
            <p className="text-[14px]">
              <span className="text-ink/50">Setup code: </span>
              <span className="font-serif text-xl font-medium tracking-widest">
                {code}
              </span>
            </p>
          )}
          <button
            onClick={regenerate}
            disabled={busy}
            className={`mt-2 ${outlineBtn}`}
          >
            Regenerate code
          </button>
        </div>
      )}

      {err && <p className="mt-2 text-sm text-blush-deep">{err}</p>}
    </div>
  );
}
