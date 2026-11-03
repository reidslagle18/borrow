import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { chargeRenterForRental, type ChargeKind } from "@/lib/charges";
import { getProgram } from "@/lib/credits";

const ALLOWED: ChargeKind[] = [
  "late_fee",
  "replacement",
  "repair",
  "hanger",
  "garment_bag",
];

/**
 * Admin-only (gated by proxy.ts): charge a rental's renter a fee AFTER the fact.
 * Check-in normally collects hanger / garment-bag / damage fees, but staff often
 * only notice a missing hanger back at the rack once the piece is already
 * checked in. This lets them add that charge to the card on file without
 * re-opening the return. Same collection behavior as check-in: if the card can't
 * be charged, it's recorded as uncollected with a pay link (never blocks).
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const rentalId = Number(b.rental_id);
  const kind = b.kind as ChargeKind;
  if (!rentalId || !ALLOWED.includes(kind)) {
    return NextResponse.json(
      { error: "rental_id and a valid kind are required." },
      { status: 400 }
    );
  }

  // Use the amount given, or fall back to the configured hanger fee.
  let amount = Number(b.amount);
  if (!(amount > 0) && kind === "hanger") {
    const program = await getProgram();
    amount = Number(program.hanger_fee) || 0;
  }
  if (!(amount > 0)) {
    return NextResponse.json(
      { error: "A positive amount is required for this charge." },
      { status: 400 }
    );
  }

  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.trim()
      : `${kind.replace(/_/g, " ")} — rental #${rentalId}`;

  // Retry: a previous charge of this kind failed (declined / no funds). Use a
  // fresh idempotency key so Stripe makes a NEW attempt on the saved card
  // instead of replaying the cached failed result.
  const retry = b.retry === true;

  const result = await chargeRenterForRental({
    rentalId,
    amount,
    kind,
    description,
    origin: new URL(request.url).origin,
    ...(retry ? { idempotencyKey: `charge_${kind}_${rentalId}_r${Date.now()}` } : {}),
  });
  return NextResponse.json({ ok: true, amount, retry, ...result });
}
