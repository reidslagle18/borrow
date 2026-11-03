"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlobalSearch, NotificationsBell } from "@/components/StudioTools";

type NavItem = { href: string; label: string };

// Grouped navigation. Related views live under one heading so the sidebar reads
// as a few clear areas instead of one long flat list. "Today" is pinned on top
// as the daily starting point. Consignor Holds, Drop-offs and Storage & Pickups
// are grouped together under Consignors.
const NAV_GROUPS: { section: string | null; items: NavItem[] }[] = [
  { section: null, items: [{ href: "/today", label: "Today" }] },
  {
    section: "Storefront",
    items: [
      { href: "/inventory", label: "Inventory" },
      { href: "/recommended", label: "Recommended" },
      { href: "/hero", label: "Hero photos" },
    ],
  },
  {
    section: "Sales",
    items: [
      { href: "/checkout", label: "Checkout" },
      { href: "/quick-charge", label: "Quick Charge" },
      { href: "/orders", label: "Orders" },
      { href: "/returns", label: "Returns" },
    ],
  },
  {
    section: "Reservations",
    items: [
      { href: "/calendar", label: "Calendar" },
      { href: "/lookup", label: "Look up piece" },
      { href: "/pull-list", label: "Pull List" },
    ],
  },
  {
    section: "Consignors",
    items: [
      { href: "/consignors", label: "Consignors" },
      { href: "/retrievals", label: "Consignor Holds" },
      { href: "/dropoff", label: "Drop-offs" },
      { href: "/pickups", label: "Storage & Pickups" },
    ],
  },
  {
    section: "Business",
    items: [
      { href: "/customers", label: "Customers" },
      { href: "/finances", label: "Finances" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

// Flattened order for the mobile top-bar scroller (section headers don't fit a
// horizontal pill strip).
const NAV_FLAT: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

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
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.section ?? "top"} className={gi > 0 ? "mt-3" : ""}>
              {group.section && (
                <p className="mb-1 px-4 text-[10px] font-medium uppercase tracking-[0.18em] text-ink/35">
                  {group.section}
                </p>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-full px-4 py-2.5 text-[15px] transition-colors ${
                    isActive(item.href)
                      ? "bg-ink text-cream"
                      : "text-ink/70 hover:bg-ink/5"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
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
          </div>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
          {NAV_FLAT.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${
                isActive(item.href) ? "bg-ink text-cream" : "bg-ink/5 text-ink/70"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
