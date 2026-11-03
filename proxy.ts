import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  VIEWAS_COOKIE,
  verifyToken,
} from "@/lib/session";

// Routes a staff login (or an admin previewing staff) may never reach. Admin-only
// APIs enforce this again in-route via requireAdmin(); this is the first gate.
function isStaffForbidden(pathname: string): boolean {
  return (
    pathname === "/finances" ||
    pathname.startsWith("/finances/") ||
    pathname.startsWith("/api/finances")
  );
}

export async function proxy(request: NextRequest) {
  // Gate disabled until APP_PASSWORD is configured.
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/api/logout" ||
    pathname.startsWith("/api/public/") || // customer-site endpoints carry their own auth
    pathname.startsWith("/api/cron/") || // Vercel Cron; guarded by CRON_SECRET
    pathname === "/api/stripe/webhook" || // Stripe webhook; verified by signature
    pathname.startsWith("/connect/") // Stripe Connect onboarding return (consignor-facing)
  ) {
    return NextResponse.next();
  }

  const identity = await verifyToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!identity) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Role gate: staff — and an admin previewing staff (view-as) — can't open the
  // admin-only areas. True admins (not previewing) pass through.
  const viewingAsStaff =
    identity.kind === "admin" && request.cookies.get(VIEWAS_COOKIE)?.value === "1";
  if ((identity.kind === "staff" || viewingAsStaff) && isStaffForbidden(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Admins only" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
