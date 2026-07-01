import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

/**
 * List registered Terminal readers with their Location, so Settings can group
 * them by store location and let staff pick which reader to charge to.
 */
export async function GET() {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }
  const [readers, locations] = await Promise.all([
    stripe.terminal.readers.list({ limit: 100 }),
    stripe.terminal.locations.list({ limit: 100 }),
  ]);
  const locName = new Map(locations.data.map((l) => [l.id, l.display_name]));
  return NextResponse.json({
    readers: readers.data.map((r) => {
      const locId = typeof r.location === "string" ? r.location : r.location?.id ?? null;
      return {
        id: r.id,
        label: r.label,
        device_type: r.device_type,
        status: r.status,
        location: locId,
        location_name: locId ? locName.get(locId) ?? null : null,
      };
    }),
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
