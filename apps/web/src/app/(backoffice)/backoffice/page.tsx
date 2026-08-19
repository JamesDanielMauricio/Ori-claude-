import { redirect } from "next/navigation";

// The source's Backoffice has no bare "/backoffice" screen — it always
// lands on a tab. `shop` is the first item in the sidebar, so it's the
// default landing route, per the PRD's "self-correct to default tab" rule.
export default function BackofficeIndexPage() {
  redirect("/backoffice/shop");
}
