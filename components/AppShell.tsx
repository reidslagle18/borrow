"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/inventory", label: "Inventory", ready: true },
  { href: "/recommended", label: "Recommended", ready: true },
  { href: "/checkout", label: "Checkout", ready: true },
  { href: "/orders", label: "Orders", ready: true },
  { href: "/calendar", label: "Calendar", ready: true },
  { href: "/returns", label: "Returns", ready: true },
  { href: "/dropoff", label: "Drop-offs", ready: true },
  { href: "/consignors", label: "Consignors", ready: true },
  { href: "/ambassadors", label: "Ambassadors", ready: true },
  { href: "/finances", label: "Finances", ready: true },
  { href: "/customers", label: "Customers", ready: true },
  { href: "/settings", label: "Settings", ready: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop / iPad landscape) */}
      <aside className="hidden shrink-0 md:flex md:h-screen md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-ink/10 md:px-6 md:py-8 lg:sticky lg:top-0">
        <Link href="/inventory" className="block">
          <span className="font-serif text-3xl italic font-medium tracking-tight">
            BORROW
          </span>
          <span className="mt-1 block text-[10px] uppercase tracking-[0.3em] text-ink/45">
            Studio
          </span>
        </Link>
        <nav className="mt-10 flex flex-col gap-1">
          {NAV.map((item) =>
            item.ready ? (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-3 text-[15px] transition-colors ${
                  pathname.startsWith(item.href)
                    ? "bg-ink text-cream"
                    : "text-ink/70 hover:bg-ink/5"
                }`}
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.href}
                className="flex items-center justify-between rounded-full px-4 py-2.5 text-[15px] text-ink/30"
              >
                {item.label}
                <span className="text-[9px] uppercase tracking-widest">soon</span>
              </span>
            )
          )}
        </nav>
      </aside>

      {/* Top bar (mobile / iPad portrait) */}
      <div className="md:hidden sticky top-0 z-30 border-b border-ink/10 bg-cream/95 backdrop-blur">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <Link href="/inventory">
            <span className="font-serif text-2xl italic font-medium">BORROW</span>
            <span className="ml-2 text-[9px] uppercase tracking-[0.3em] text-ink/45">
              Studio
            </span>
          </Link>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
          {NAV.map((item) =>
            item.ready ? (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${
                  pathname.startsWith(item.href)
                    ? "bg-ink text-cream"
                    : "bg-ink/5 text-ink/70"
                }`}
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.href}
                className="whitespace-nowrap rounded-full bg-ink/[0.03] px-3.5 py-1.5 text-sm text-ink/30"
              >
                {item.label}
              </span>
            )
          )}
        </nav>
      </div>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
