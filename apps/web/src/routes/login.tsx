import { resolveHomeRoute } from "@ori/shared/roles";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

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
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, must_change_password")
      .eq("user_id", data.user.id)
      .single();

    // A failed READ and a genuinely missing row are different problems and no
    // longer collapse into the same silent outcome. Previously both ended in
    // a signOut() with no message, so a dropped connection right after a
    // correct password looked exactly like a rejected sign-in that forgot to
    // say why: the spinner stopped and nothing else happened, with no way to
    // tell whether retrying was worth it.
    //
    // PGRST116 is PostgREST's "no rows" for a .single(); anything else is a
    // transport or server failure, where the credentials were fine and a
    // retry is the right advice.
    if (profileError && profileError.code !== "PGRST116") {
      await supabase.auth.signOut();
      setError("ההתחברות הצליחה אך טעינת הפרופיל נכשלה. בדוק את החיבור ונסה שוב.");
      setIsSubmitting(false);
      return;
    }

    if (!profile) {
      // Authenticated with Supabase but no matching profiles row — a
      // corrupt/orphan account per the PRD's documented edge case
      // (reference/prd/role-based-routing.md). There is nowhere sensible to
      // route them, and the account needs an admin, not a retry — so say that
      // rather than leaving the form looking unresponsive.
      await supabase.auth.signOut();
      setError("החשבון אינו מקושר לפרופיל במערכת. פנה למנהל המערכת.");
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
        {/* <Link>, not <a href>: a bare anchor triggers a full document load,
            which in an SPA throws away the running app and re-downloads the
            bundle to move between two screens the router already has. */}
        {/* `inline-flex min-h-10 px-3` rather than a bare inline link: as
            plain text this was a 76×18 target — the recovery route for
            someone who has already failed to sign in, usually on a phone,
            usually in a hurry. The box only grows the hit area; the
            centred paragraph keeps it looking the same. */}
        <Link
          to="/reset-password"
          className="inline-flex min-h-10 items-center justify-center rounded-md px-3 text-accent hover:underline"
        >
          שכחת סיסמה?
        </Link>
      </p>
    </AuthCard>
  );
}
