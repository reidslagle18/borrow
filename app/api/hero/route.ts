import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import {
  getHeroConfig,
  getHeroLibrary,
  getCategoryTiles,
  getOccasionTiles,
  CATEGORY_TILE_LABELS,
  OCCASION_TILE_LABELS,
  DEFAULT_HERO_LIBRARY,
  type HeroSlide,
  type TileConfig,
} from "@/lib/hero";

/** Editor load: hero slides (with crops), the pickable library, and the
 *  Shop-by-Category / Shop-by-Occasion tile photos. */
export async function GET() {
  await ensureSchema();
  const [config, library, categoryTiles, occasionTiles] = await Promise.all([
    getHeroConfig(),
    getHeroLibrary(),
    getCategoryTiles(),
    getOccasionTiles(),
  ]);
  return NextResponse.json({
    config,
    library,
    category_tiles: categoryTiles,
    occasion_tiles: occasionTiles,
    category_labels: CATEGORY_TILE_LABELS,
    occasion_labels: OCCASION_TILE_LABELS,
  });
}

/** Keep only valid {label: non-empty src} pairs for the allowed labels. */
function cleanTiles(v: unknown, labels: string[]): TileConfig {
  const out: TileConfig = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const label of labels) {
      const src = o[label];
      if (typeof src === "string" && src.trim()) out[label] = src.trim();
    }
  }
  return out;
}

/** Editor save: overwrite the hero slides and (optionally) the library. */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const config: HeroSlide[] = (Array.isArray(b.config) ? b.config : [])
    .map((v: unknown) => {
      if (!v || typeof v !== "object") return null;
      const o = v as Record<string, unknown>;
      const src = typeof o.src === "string" ? o.src.trim() : "";
      if (!src) return null;
      const num = (x: unknown, d: number) => (Number.isFinite(Number(x)) ? Number(x) : d);
      return {
        src,
        posX: clamp(num(o.posX, 50), 0, 100),
        posY: clamp(num(o.posY, 50), 0, 100),
        zoom: clamp(num(o.zoom, 1), 1, 3),
      };
    })
    .filter((s: HeroSlide | null): s is HeroSlide => s !== null);

  // The library is the pool to pick from — keep the shipped defaults plus any
  // uploaded URLs (and whatever's currently used). Never let it go empty.
  const categoryTiles = cleanTiles(b.category_tiles, CATEGORY_TILE_LABELS);
  const occasionTiles = cleanTiles(b.occasion_tiles, OCCASION_TILE_LABELS);

  const uploaded: string[] = Array.isArray(b.library)
    ? b.library.map((x: unknown) => String(x)).filter(Boolean)
    : [];
  const library = Array.from(
    new Set([
      ...DEFAULT_HERO_LIBRARY,
      ...uploaded,
      ...config.map((s) => s.src),
      ...Object.values(categoryTiles),
      ...Object.values(occasionTiles),
    ])
  );

  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('hero_config', ${JSON.stringify(config)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('hero_library', ${JSON.stringify(library)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('category_tiles', ${JSON.stringify(categoryTiles)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('occasion_tiles', ${JSON.stringify(occasionTiles)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return NextResponse.json({
    ok: true,
    config,
    library,
    category_tiles: categoryTiles,
    occasion_tiles: occasionTiles,
  });
}
