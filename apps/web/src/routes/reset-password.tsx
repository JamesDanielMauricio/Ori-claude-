import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { AuthCard } from "@/components/auth/auth-card";
import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function RequestPasswordResetPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    const supabase = createClient();
    // Supabase's own recovery flow: a single-use, time-limited link — no
    // custom temporary-password mechanism, which is exactly what R3 asks
    // for and avoids the PRD's reusable-plaintext-temp-password bug.
    // The recovery link's default flow authenticates the browser via a URL
    // fragment the client library auto-detects on load — no separate
    // "confirm" page needed; /change-password already handles "I have a
    // session and need to set a new password" for both this flow and the
    // forced first-login case.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/change-password`,
    });

    // Always the same outcome regardless of whether the email exists — no
    // enumeration leak, matching the PRD's documented sign-in behavior.
    setSubmitted(true);
    setIsSubmitting(false);
  }

  return (
    <AuthCard
      title="איפוס סיסמה"
      subtitle="נשלח לך קישור חד-פעמי לקביעת סיסמה חדשה."
    >
      {submitted ? (
        <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">
          אם קיים חשבון עם האימייל הזה, נשלח אליו קישור לאיפוס. הקישור תקף לשעה אחת וניתן
          לשימוש פעם אחת בלבד.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormField label="אימייל" htmlFor="email">
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className={`${inputClassName} w-full`}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "שולח…" : "שלח קישור לאיפוס"}
          </Button>
        </form>
      )}

      <p className="mt-4 text-center text-sm">
        {/* <Link>, not <a href> — see login.tsx: a bare anchor full-reloads
            the SPA to reach a route the router already holds. */}
        <Link to="/login" className="text-accent hover:underline">
          חזרה להתחברות
        </Link>
      </p>
    </AuthCard>
  );
}
