import { redirect } from "next/navigation";

// Per the PRD, Grower Home's "Daily List mode" (tab=list) is the default —
// the source page self-redirects here if the tab param is missing.
export default function GrowerIndexPage() {
  redirect("/grower/picks");
}
