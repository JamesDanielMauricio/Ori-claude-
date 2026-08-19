import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth-guard";

const ROLE_HOME: Record<string, string> = {
  backoffice: "/backoffice",
  grower: "/grower",
  customer: "/customer",
};

// The single entry point that decides where a signed-in user lands —
// downstream, each role's own layout (via requireRole) is still the
// actual gate; this just avoids showing an empty root page.
export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.mustChangePassword) {
    redirect("/change-password");
  }

  redirect(ROLE_HOME[user.role] ?? "/login");
}
