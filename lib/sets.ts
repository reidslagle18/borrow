import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * Link two pieces into the same matching set. If the partner is already in a
 * set, this piece joins it; otherwise a new set id is minted for both.
 */
export async function linkItemsIntoSet(
  itemId: string,
  partnerId: string
): Promise<string | null> {
  if (!partnerId || partnerId === itemId) return null;
  const partner = await sql`SELECT set_group FROM items WHERE id = ${partnerId}`;
  if (partner.length === 0) return null;
  const group = (partner[0].set_group as string | null) || `set_${randomUUID()}`;
  await sql`UPDATE items SET set_group = ${group}, updated_at = now() WHERE id = ${itemId}`;
  await sql`UPDATE items SET set_group = ${group}, updated_at = now() WHERE id = ${partnerId}`;
  return group;
}

/** Remove a piece from its matching set (leaves any others linked to each other). */
export async function unlinkFromSet(itemId: string): Promise<void> {
  await sql`UPDATE items SET set_group = NULL, updated_at = now() WHERE id = ${itemId}`;
}
