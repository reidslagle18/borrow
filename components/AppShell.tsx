"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { GlobalSearch, NotificationsBell } from "@/components/StudioTools";
import { useMe } from "@/lib/useMe";

// One simple, merged menu. Each top-level entry owns a set of routes; related
// screens (Checkout + Quick Charge, Orders + Returns, Inventory + Look up + Pull
// list, and the four consignor screens) are reached through the sub-tab strip
// rendered under the header. Finances is admin-only.
type Tab = { href: string; label: string; adminOnly?: boolean };
type Group = {
  href: string;
  label: string;
  match: string[];
  adminOnly?: boolean;
  tabs?: Tab[];
};

const GROUPS: Group[] = [
  { href: "/today", label: "Today", match: ["/today"] },
  {
    href: "/checkout",
    label: "Checkout",
    match: ["/checkout", "/quick-charge"],
    tabs: [
      { href: "/checkout", label: "Checkout" },
      { href: "/quick-charge", label: "Quick Charge" },
    ],
  },
  {
    href: "/orders",
    label: "Orders",
    match: ["/orders", "/returns"],
    tabs: [
      { href: "/orders", label: "All orders" },
      { href: "/returns", label: "Returns" },
    ],
  },
  {
    href: "/inventory",
    label: "Inventory",
    match: ["/inventory", "/lookup", "/pull-list"],
    tabs: [
      { href: "/inventory", label: "Inventory" },
      { href: "/inventory/featured", label: "Featured", adminOnly: true },
      { href: "/lookup", label: "Look up a piece" },
      { href: "/pull-list", label: "Pull list" },
    ],
  },
  { href: "/calendar", label: "Calendar", match: ["/calendar"] },
  { href: "/customers", label: "Customers", match: ["/customers"] },
  {
    href: "/consignors",
    label: "Consignors",
    match: ["/consignors", "/dropoff", "/retrievals", "/pickups"],
    tabs: [
      { href: "/consignors", label: "Consignors" },
      { href: "/dropoff", label: "Drop-offs" },
      { href: "/retrievals", label: "Holds" },
      { href: "/pickups", label: "Storage & Pickups" },
    ],
  },
  { href: "/finances", label: "Finances", match: ["/finances"], adminOnly: true },
  { href: "/settings", label: "Settings", match: ["/settings"] },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading } = useMe();

  // If a staff login was disabled mid-session, /api/me returns null — bounce to
  // the login screen.
  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [loading, me, router]);

  const isAdminView = me?.role === "admin"; // effective (admin + view-as ⇒ staff)
  const groups = GROUPS.filter((g) => !g.adminOnly || isAdminView);

  const groupActive = (g: Group) =>
    g.match.some((m) => pathname === m || pathname.startsWith(m + "/"));
  const activeGroup = GROUPS.find(groupActive);
  const tabs = activeGroup?.tabs?.filter((t) => !t.adminOnly || isAdminView);
  // The active tab is the longest href that prefixes the current path, so
  // /inventory/featured highlights "Featured" (not also "Inventory").
  const activeTabHref = (tabs ?? [])
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }
  async function toggleViewAs(on: boolean) {
    await fetch("/api/viewas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    });
    window.location.href = "/today";
  }

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop / iPad landscape) */}
      <aside className="hidden shrink-0 md:flex md:h-screen md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-ink/10 md:px-6 md:py-8 lg:sticky lg:top-0">
        <Link href="/today" className="block">
          <span className="font-serif text-3xl italic font-medium tracking-tight">
            BORROW
          </span>
          <span className="mt-1 block text-[10px] uppercase tracking-[0.3em] text-ink/45">
            Studio
          </span>
        </Link>
        <GlobalSearch variant="sidebar" />
        <NotificationsBell variant="sidebar" />
        <nav className="mt-5 flex flex-col gap-1">
          {groups.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className={`block rounded-full px-4 py-2.5 text-[15px] transition-colors ${
                groupActive(g) ? "bg-ink text-cream" : "text-ink/70 hover:bg-ink/5"
              }`}
            >
              {g.label}
            </Link>
          ))}
        </nav>

        {/* Account footer */}
        <div className="mt-auto pt-6">
          {me && (
            <p className="px-4 text-[11px] uppercase tracking-[0.18em] text-ink/35">
              {me.name}
              {me.isAdmin ? " · Admin" : " · Staff"}
            </p>
          )}
          {me?.isAdmin && !me.viewAs && (
            <button
              onClick={() => toggleViewAs(true)}
              className="mt-2 block w-full rounded-full border border-ink/15 px-4 py-2 text-left text-[13px] text-ink/60 hover:border-ink/35"
            >
              View as staff
            </button>
          )}
          <button
            onClick={logout}
            className="mt-2 block w-full rounded-full px-4 py-2 text-left text-[13px] text-ink/50 hover:bg-ink/5"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Top bar (mobile / iPad portrait) */}
      <div className="md:hidden sticky top-0 z-30 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <Link href="/today">
            <span className="font-serif text-2xl italic font-medium">BORROW</span>
            <span className="ml-2 text-[9px] uppercase tracking-[0.3em] text-ink/45">
              Studio
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <GlobalSearch variant="topbar" />
            <NotificationsBell variant="topbar" />
            <button
              onClick={logout}
              aria-label="Sign out"
              className="flex h-9 items-center rounded-full border border-ink/15 bg-white px-3 text-[12px] text-ink/60"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
          {groups.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${
                groupActive(g) ? "bg-ink text-cream" : "bg-ink/5 text-ink/70"
              }`}
            >
              {g.label}
            </Link>
          ))}
        </nav>
      </div>

      <main className="min-w-0 flex-1">
        {/* View-as banner */}
        {me?.viewAs && (
          <div className="flex items-center justify-between gap-3 bg-ink px-5 py-2 text-[13px] text-cream md:px-10">
            <span>Previewing the staff view — admin-only areas are hidden.</span>
            <button
              onClick={() => toggleViewAs(false)}
              className="shrink-0 rounded-full bg-cream px-3 py-1 text-[12px] font-medium text-ink"
            >
              Exit staff view
            </button>
          </div>
        )}

        {/* Sub-tab strip for merged sections */}
        {tabs && tabs.length > 1 && (
          <div className="border-b border-ink/10 bg-cream/60">
            <div className="flex gap-1.5 overflow-x-auto px-5 py-2.5 md:px-10 [scrollbar-width:none]">
              {tabs.map((t) => {
                const active = t.href === activeTabHref;
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                      active
                        ? "bg-ink text-cream"
                        : "bg-white text-ink/60 hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}
