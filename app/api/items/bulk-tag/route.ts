import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

/**
 * Admin-only (gated by proxy.ts): apply or remove an occasion (and optional
 * sub-occasion) tag on many pieces at once — for backfilling occasion tags
 * across existing inventory without opening each piece.
 *
 * Body: {
 *   ids: string[],            // item ids to tag
 *   occasion: string,         // top-level occasion, e.g. "Vacation"
 *   sub?: string,             // optional sub-occasion, e.g. "Beach"
 *   mode?: "add" | "remove"   // default "add"
 * }
 * Sub-occasion tags are stored namespaced as "Occasion:Sub". Adding a sub also
 * ensures the parent occasion tag is present; removing an occasion (no sub) also
 * strips all of its sub tags.
 */
export async function POST(request: Request) {
  await ensureSchema();
  const b = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.ids)
    ? b.ids.map((x: unknown) => String(x)).filter(Boolean)
    : [];
  const occasion = String(b.occasion ?? "").trim();
  const sub = b.sub != null ? String(b.sub).trim() : "";
  const mode = b.mode === "remove" ? "remove" : "add";
  if (ids.length === 0 || !occasion) {
    return NextResponse.json(
      { error: "ids and occasion are required" },
      { status: 400 }
    );
  }
  const subTag = sub ? `${occasion}:${sub}` : null;

  if (mode === "add") {
    // Dedup-append the occasion; add the namespaced sub tag too when given (and
    // the parent occasion is guaranteed present by the occasion append above).
    await sql`
      UPDATE items SET
        occasion_tags = ARRAY(
          SELECT DISTINCT e FROM unnest(occasion_tags || ARRAY[${occasion}]::text[]) AS e
        ),
        sub_occasion_tags = ARRAY(
          SELECT DISTINCT e FROM unnest(
            sub_occasion_tags || ${subTag ? [subTag] : []}::text[]
          ) AS e
        ),
        updated_at = now()
      WHERE id = ANY(${ids}::text[])
    `;
  } else {
    // Remove: a specific sub → drop just that namespaced tag; a whole occasion
    // (no sub) → drop the occasion AND every "Occasion:*" sub tag.
    if (subTag) {
      await sql`
        UPDATE items SET
          sub_occasion_tags = array_remove(sub_occasion_tags, ${subTag}),
          updated_at = now()
        WHERE id = ANY(${ids}::text[])
      `;
    } else {
      await sql`
        UPDATE items SET
          occasion_tags = array_remove(occasion_tags, ${occasion}),
          sub_occasion_tags = ARRAY(
            SELECT e FROM unnest(sub_occasion_tags) AS e WHERE e NOT LIKE ${occasion + ":%"}
          ),
          updated_at = now()
        WHERE id = ANY(${ids}::text[])
      `;
    }
  }

  return NextResponse.json({ ok: true, updated: ids.length, mode, occasion, sub: sub || null });
}
