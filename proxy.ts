import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

async function expectedToken(): Promise<string> {
  const data = new TextEncoder().encode(`borrow:${process.env.APP_PASSWORD}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function proxy(request: NextRequest) {
  // Gate disabled until APP_PASSWORD is configured
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname.startsWith("/api/public/") || // customer-site endpoints carry their own auth
    pathname.startsWith("/api/cron/") || // Vercel Cron; guarded by CRON_SECRET
    pathname === "/api/stripe/webhook" // Stripe webhook; verified by signature
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("borrow_session")?.value;
  if (cookie && cookie === (await expectedToken())) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
