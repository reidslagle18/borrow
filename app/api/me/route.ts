import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Current identity for the client shell/pages. 401 when unauthenticated or when a
// staff login has been disabled (so the client bounces them to /login).
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    role: s.effectiveRole, // what the UI renders as
    trueRole: s.trueRole, // real role (admin even while previewing staff)
    name: s.name,
    userId: s.userId,
    viewAs: s.viewAs,
    isAdmin: s.trueRole === "admin",
  });
}
