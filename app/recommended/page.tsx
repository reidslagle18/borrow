import { redirect } from "next/navigation";

// Part 1 removal: the "Recommended" curation editor is removed from the studio
// interface. The stored order (/api/recommended) and the shop's use of it are
// left untouched, so the shop's order stays exactly as it is now. Any direct
// visit is sent to Today.
export default function RecommendedPage() {
  redirect("/today");
}
