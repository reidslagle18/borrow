import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Global studio search: pieces, customers, and consignors in one query.
 * Matches the same fields the individual pages search on.
 */
export async function GET(request: Request) {
  await ensureSchema();
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ pieces: [], customers: [], consignors: [] });
  }
  const like = `%${q}%`;

  const [pieces, customers, consignors] = await Promise.all([
    sql`
      SELECT i.id, i.barcode, COALESCE(NULLIF(i.name, ''), i.brand) AS label,
             i.size, i.status, i.photo_url
      FROM items i
      WHERE i.brand ILIKE ${like} OR COALESCE(i.name,'') ILIKE ${like}
         OR COALESCE(i.barcode,'') ILIKE ${like} OR i.id ILIKE ${like}
         OR COALESCE(i.color,'') ILIKE ${like} OR COALESCE(i.description,'') ILIKE ${like}
      ORDER BY i.created_at DESC
      LIMIT 6
    `,
    sql`
      SELECT c.id, c.name, c.phone, c.email
      FROM customers c
      WHERE c.name ILIKE ${like} OR COALESCE(c.phone,'') ILIKE ${like}
         OR COALESCE(c.email,'') ILIKE ${like}
      ORDER BY c.name ASC
      LIMIT 5
    `,
    sql`
      SELECT c.id, c.name, c.phone, c.email
      FROM consignors c
      WHERE c.name ILIKE ${like} OR COALESCE(c.phone,'') ILIKE ${like}
         OR COALESCE(c.email,'') ILIKE ${like}
      ORDER BY c.name ASC
      LIMIT 5
    `,
  ]);

  return NextResponse.json({ pieces, customers, consignors });
}
