"use client";

import { resolveHomeRoute } from "@ori/shared/roles";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { FormField } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    // Covers both cases this page serves: a forced first-login change
    // (the session comes from a Supabase recovery-link exchange, detected
    // automatically on load) and a voluntary change from an already
    // signed-in session.
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push("/login");
        return;
      }
      setCheckingSession(false);
    });
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.push("/login");
      return;
    }

    // No "current password" re-entry — possession of a valid session (via
    // ordinary sign-in or a Supabase recovery link) is the authorization.
    // This also closes the PRD's documented bug where the equivalent field
    // was present but never actually checked.
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setError(updateError.message);
      setIsSubmitting(false);
      return;
    }

    // Self-write permitted by the "profiles_update_own" RLS policy.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("user_id", userData.user.id)
      .select("role")
      .single();

    if (profileError || !profile) {
      setError("הסיסמה עודכנה, אך משהו השתבש בסיום התהליך. נסה להתחבר מחדש.");
      setIsSubmitting(false);
      return;
    }

    router.push(resolveHomeRoute(profile.role));
  }

  if (checkingSession) {
    return null;
  }

  return (
    <AuthCard
      title="קביעת סיסמה חדשה"
      subtitle="לפחות 8 תווים. לאחר השמירה תועבר ישירות למסך הבית שלך."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField label="סיסמה חדשה" htmlFor="newPassword">
          <PasswordInput
            id="newPassword"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={8}
          />
        </FormField>

        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "שומר…" : "שמור סיסמה חדשה"}
        </Button>
      </form>
    </AuthCard>
  );
}
