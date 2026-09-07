import { resolveHomeRoute } from "@ori/shared/roles";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/auth/password-input";
import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setError("אימייל או סיסמה שגויים.");
      setIsSubmitting(false);
      return;
    }

    // RLS-protected read: "profiles_select_own" is what permits this — see
    // docs/SCHEMA_DECISIONS.md.
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, must_change_password")
      .eq("user_id", data.user.id)
      .single();

    if (!profile) {
      // Authenticated with Supabase but no matching profiles row — a
      // corrupt/orphan account per the PRD's documented edge case
      // (reference/prd/role-based-routing.md). There is nowhere sensible
      // to route them; stay on login without a misleading error.
      await supabase.auth.signOut();
      setIsSubmitting(false);
      return;
    }

    if (profile.must_change_password) {
      navigate("/change-password");
      return;
    }

    navigate(resolveHomeRoute(profile.role));
  }

  return (
    <AuthCard title="התחברות" subtitle="שיווק תוצרת חקלאית למגזר הסיטונאי">
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

        <FormField label="סיסמה" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} />
        </FormField>

        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "מתחבר…" : "התחברות"}
        </Button>
      </form>

      <p className="mt-4 text-center text-sm">
        <a href="/reset-password" className="text-accent hover:underline">
          שכחת סיסמה?
        </a>
      </p>
    </AuthCard>
  );
}
