import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";

/** Public config the shop needs to show correct totals (fee + tax rate). */
export async function GET(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const p = await getProgram();
  return NextResponse.json(
    { cleaning_fee: p.cleaning_fee, sales_tax_rate: p.sales_tax_rate },
    { headers: { "Cache-Control": "no-store" } }
  );
}
