import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { VIEWAS_COOKIE } from "@/lib/session";

// Admin toggles "View as staff". Stored in its own cookie so the admin keeps
// their real admin token (and full access) — this only changes what the UI shows.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { on } = (await request.json().catch(() => ({}))) as { on?: boolean };
  const res = NextResponse.json({ ok: true, viewAs: !!on });
  if (on) {
    res.cookies.set(VIEWAS_COOKIE, "1", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  } else {
    res.cookies.set(VIEWAS_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
