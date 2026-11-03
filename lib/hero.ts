import { sql } from "@/lib/db";

/**
 * Homepage hero photos for the shop. Each slide carries its own crop: posX/posY
 * are the focal point (object-position %, 0–100) and zoom is a scale (1 = fit).
 * Owner-editable from the studio /hero page; the shop reads them via the public
 * config feed and renders the exact same crop.
 */
export type HeroSlide = { src: string; posX: number; posY: number; zoom: number };

/** The photos already shipped in the shop's /public/store (served on the shop
 *  origin). Uploads (blob URLs) get appended to the library on top of these. */
export const DEFAULT_HERO_LIBRARY: string[] = [
  "/store/space.jpg",
  "/store/sign.jpg",
  "/store/gowns.jpg",
  "/store/racks.jpg",
  "/store/storefront.jpg",
  "/store/gallery/rainbow.jpg",
  "/store/gallery/beaded.jpg",
  "/store/gallery/fitting-room.jpg",
  "/store/gallery/owner-table.jpg",
  "/store/gallery/blues.jpg",
  "/store/gallery/lace.jpg",
  "/store/gallery/owner-rack.jpg",
  "/store/gallery/warm.jpg",
];

/** The three wide shots that lead today, centered until the owner adjusts. */
export const DEFAULT_HERO_CONFIG: HeroSlide[] = [
  { src: "/store/space.jpg", posX: 50, posY: 50, zoom: 1 },
  { src: "/store/sign.jpg", posX: 50, posY: 50, zoom: 1 },
  { src: "/store/gowns.jpg", posX: 50, posY: 50, zoom: 1 },
];

/** Coerce one stored slide into a valid HeroSlide (clamped), or null if junk. */
function cleanSlide(v: unknown): HeroSlide | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const src = typeof o.src === "string" ? o.src.trim() : "";
  if (!src) return null;
  const num = (x: unknown, d: number) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
  };
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return {
    src,
    posX: clamp(num(o.posX, 50), 0, 100),
    posY: clamp(num(o.posY, 50), 0, 100),
    zoom: clamp(num(o.zoom, 1), 1, 3),
  };
}

export async function getHeroConfig(): Promise<HeroSlide[]> {
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'hero_config'`;
  const v = rows[0]?.value;
  if (!Array.isArray(v)) return DEFAULT_HERO_CONFIG;
  const slides = v.map(cleanSlide).filter((s): s is HeroSlide => s !== null);
  return slides.length ? slides : DEFAULT_HERO_CONFIG;
}

/* ---- Shop-by-Category / Shop-by-Occasion tile photos (homepage landing) ----
   Owner sets an optional photo per tile from the same /hero editor + library.
   Stored as { label: src } maps; a missing/empty value = fall back to the color
   block on the shop. Labels mirror the shop landing's tiles. */
export const CATEGORY_TILE_LABELS = ["Dresses", "Sets", "Tops", "Skirts", "Pants"];
export const OCCASION_TILE_LABELS = [
  "Vacation",
  "Gameday",
  "Date Night",
  "Formal",
  "Wedding Guest",
  "Graduation",
];
export type TileConfig = Record<string, string>;

function cleanTileMap(v: unknown, labels: string[]): TileConfig {
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

export async function getCategoryTiles(): Promise<TileConfig> {
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'category_tiles'`;
  return cleanTileMap(rows[0]?.value, CATEGORY_TILE_LABELS);
}

export async function getOccasionTiles(): Promise<TileConfig> {
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'occasion_tiles'`;
  return cleanTileMap(rows[0]?.value, OCCASION_TILE_LABELS);
}

export async function getHeroLibrary(): Promise<string[]> {
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'hero_library'`;
  const saved = Array.isArray(rows[0]?.value)
    ? (rows[0]!.value as unknown[]).map((x) => String(x)).filter(Boolean)
    : [];
  // Always offer the shipped photos, plus any the owner has uploaded.
  return Array.from(new Set([...DEFAULT_HERO_LIBRARY, ...saved]));
}
