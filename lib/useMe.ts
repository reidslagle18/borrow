"use client";

import { useEffect, useState } from "react";

export type Me = {
  role: "admin" | "staff"; // effective role (admin + view-as ⇒ "staff")
  trueRole: "admin" | "staff";
  name: string;
  userId: number | null;
  viewAs: boolean;
  isAdmin: boolean; // true admin regardless of view-as
};

// Module-level cache so /api/me is fetched once per page load and shared across
// every component that needs the role, instead of each firing its own request.
let cache: Me | null = null;
let resolved = false;
let inflight: Promise<Me | null> | null = null;
const listeners = new Set<(m: Me | null) => void>();

async function fetchMe(): Promise<Me | null> {
  try {
    const r = await fetch("/api/me", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Me;
  } catch {
    return null;
  }
}

export function refreshMe(): Promise<Me | null> {
  inflight = fetchMe().then((m) => {
    cache = m;
    resolved = true;
    inflight = null;
    listeners.forEach((l) => l(m));
    return m;
  });
  return inflight;
}

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(cache);
  const [loading, setLoading] = useState(!resolved);

  useEffect(() => {
    let active = true;
    const l = (m: Me | null) => {
      if (!active) return;
      setMe(m);
      setLoading(false);
    };
    listeners.add(l);
    if (resolved) {
      setMe(cache);
      setLoading(false);
    } else {
      (inflight ?? refreshMe()).then((m) => {
        if (active) {
          setMe(m);
          setLoading(false);
        }
      });
    }
    return () => {
      active = false;
      listeners.delete(l);
    };
  }, []);

  return { me, loading };
}
