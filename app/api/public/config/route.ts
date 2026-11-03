import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { getProgram } from "@/lib/credits";
import { getHeroConfig, getCategoryTiles, getOccasionTiles } from "@/lib/hero";
import { activeCampaignForCode, listCampaigns } from "@/lib/campaigns";

/** Public config the shop needs to show correct totals (tax rate + launch date).
 *  cleaning_fee is 0 to the shop — the Cleaning & Care Fee is already included
 *  in each rental price and never added as a separate line. */
export async function GET(request: Request) {
  const key = request.headers.get("x-api-key");
  if (!process.env.BOOKING_API_KEY || key !== process.env.BOOKING_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureSchema();
  const [p, hero, categoryTiles, occasionTiles, campaigns] = await Promise.all([
    getProgram(),
    getHeroConfig(),
    getCategoryTiles(),
    getOccasionTiles(),
    listCampaigns(),
  ]);
  // Surface the campaign that's active TODAY (if any) so the shop can show the
  // give-back note + optional code field only while it's running.
  const todayActive = (
    await Promise.all(campaigns.map((c) => activeCampaignForCode(c.code)))
  ).find(Boolean);
  const active_campaign = todayActive
    ? {
        code: todayActive.code,
        label: todayActive.label,
        organization: todayActive.organization,
        donation_rate: todayActive.donation_rate,
      }
    : null;
  return NextResponse.json(
    {
      cleaning_fee: 0,
      sales_tax_rate: p.sales_tax_rate,
      reservations_open: p.reservations_open,
      closed_dates: p.store_closed_dates,
      closed_weekdays: p.store_closed_weekdays,
      color_swatches: p.color_swatches,
      occasions: p.occasions, // "Shop by Occasion" pills + their sub-filters
      hero, // homepage hero slides with per-photo crop (owner-editable at /hero)
      category_tiles: categoryTiles, // Shop-by-Category tile photos (label → src)
      occasion_tiles: occasionTiles, // Shop-by-Occasion tile photos (label → src)
      active_campaign, // give-back campaign running today (or null)
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
