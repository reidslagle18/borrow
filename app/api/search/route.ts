import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Global studio search: pieces, customers, and consignors in one query.
 *
 * Pieces are barcode-aware and leading-zero insensitive. Typing digits ranks:
 *   0 — exact number match (ignoring leading zeros): "561" → 000561 first
 *   1 — barcodes whose number STARTS with the digits: "56" → 000560, 000561, …
 *   2 — barcodes that merely CONTAIN the digits
 *   3 — brand / name text matches
 * Pieces search from the 1st character (so a single digit shows suggestions);
 * customers/consignors join in from the 2nd character to avoid single-digit noise.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 1) {
    return NextResponse.json({ pieces: [], customers: [], consignors: [] });
  }
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const hasDigits = digits.length > 0;
  const stripped = digits.replace(/^0+/, "");
  const strippedForLike = stripped === "" ? digits : stripped;
  const prefixLike = `${strippedForLike}%`;
  const containsBarcode = `%${digits}%`;
  const wide = q.length >= 2;

  const [pieces, customers, consignors] = await Promise.all([
    sql`
      SELECT id, barcode, COALESCE(NULLIF(name, ''), brand) AS label,
             size, status, photo_url,
             CASE
               WHEN ${hasDigits} AND ltrim(COALESCE(barcode, ''), '0') = ${strippedForLike} THEN 0
               WHEN ${hasDigits} AND ltrim(COALESCE(barcode, ''), '0') LIKE ${prefixLike} THEN 1
               WHEN ${hasDigits} AND COALESCE(barcode, '') LIKE ${containsBarcode} THEN 2
               WHEN brand ILIKE ${like} OR COALESCE(name, '') ILIKE ${like} THEN 3
               ELSE 4
             END AS rank
      FROM items
      WHERE (
          ${hasDigits} AND (
            ltrim(COALESCE(barcode, ''), '0') LIKE ${prefixLike}
            OR COALESCE(barcode, '') LIKE ${containsBarcode}
            OR id ILIKE ${like}
          )
        )
        OR brand ILIKE ${like}
        OR COALESCE(name, '') ILIKE ${like}
        OR COALESCE(color, '') ILIKE ${like}
        OR COALESCE(description, '') ILIKE ${like}
      ORDER BY rank ASC, length(COALESCE(barcode, '')) ASC, barcode ASC
      LIMIT 8
    `,
    wide
      ? sql`
          SELECT c.id, c.name, c.phone, c.email
          FROM customers c
          WHERE c.name ILIKE ${like} OR COALESCE(c.phone, '') ILIKE ${like}
             OR COALESCE(c.email, '') ILIKE ${like}
          ORDER BY c.name ASC
          LIMIT 5
        `
      : Promise.resolve([]),
    wide
      ? sql`
          SELECT c.id, c.name, c.phone, c.email
          FROM consignors c
          WHERE c.name ILIKE ${like} OR COALESCE(c.phone, '') ILIKE ${like}
             OR COALESCE(c.email, '') ILIKE ${like}
          ORDER BY c.name ASC
          LIMIT 5
        `
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ pieces, customers, consignors });
}
