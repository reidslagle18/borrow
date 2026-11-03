import { redirect } from "next/navigation";

// Part 1 removal: the hero-photo setting is removed from the studio interface.
// The current hero stays live on the website — the stored hero config (/api/hero,
// lib/hero.ts) and the shop's use of it are left untouched. Any direct visit is
// sent to Today.
export default function HeroPage() {
  redirect("/today");
}
