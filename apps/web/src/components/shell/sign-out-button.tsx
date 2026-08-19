"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton({
  className = "",
  variant = "text",
}: {
  className?: string;
  // "text" is the original plain-link look every existing caller (RoleShell)
  // still uses. "solid" is additive — a full-width filled button — opted
  // into only by BackofficeNav.
  variant?: "text" | "solid";
}) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const variantClasses =
    variant === "solid"
      ? "w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-ink hover:opacity-90"
      : "text-sm text-ink-muted hover:text-ink";

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className={`${variantClasses} disabled:opacity-50 ${className}`}
    >
      {/* The source's one English-labelled control ("Log out") — its own
          PRD flags that as a likely copy oversight, so the rebuild uses
          Hebrew like every other control. */}
      {isSigningOut ? "…" : "התנתקות"}
    </button>
  );
}
