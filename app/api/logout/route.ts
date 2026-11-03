import { NextResponse } from "next/server";
import { SESSION_COOKIE, VIEWAS_COOKIE } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  const clear = { path: "/", maxAge: 0 } as const;
  res.cookies.set(SESSION_COOKIE, "", clear);
  res.cookies.set(VIEWAS_COOKIE, "", clear);
  return res;
}
