import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

/** List registered Terminal readers (so you can grab the reader id for Settings). */
export async function GET() {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  const readers = await stripe.terminal.readers.list({ limit: 100 });
  return NextResponse.json({
    readers: readers.data.map((r) => ({
      id: r.id,
      label: r.label,
      device_type: r.device_type,
      status: r.status,
    })),
  });
}

/**
 * POST { action: "register_simulated" } — for test mode: ensure a Location and
 * register a simulated WisePOS E so the tap flow can be exercised without
 * hardware. Returns the new reader id to paste into Settings.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  const b = await request.json().catch(() => ({}));
  if (b.action !== "register_simulated") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const locations = await stripe.terminal.locations.list({ limit: 1 });
  const location =
    locations.data[0] ??
    (await stripe.terminal.locations.create({
      display_name: "BORROW Studio",
      address: {
        line1: "1 Studio Way",
        city: "Fayetteville",
        state: "AR",
        country: "US",
        postal_code: "72701",
      },
    }));

  const reader = await stripe.terminal.readers.create({
    registration_code: "simulated-wpe",
    location: location.id,
    label: "Simulated WisePOS E",
  });

  return NextResponse.json({ reader_id: reader.id, label: reader.label });
}
