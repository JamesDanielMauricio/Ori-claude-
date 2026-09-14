import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Card, FormSection } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";

interface ProfileRow {
  displayName: string;
  phoneNumber: string | null;
}

// Self-service Edit Profile (PRD: reference/prd/user-profile.md,
// edit-profile.md). Scoped deliberately to what `profiles` itself holds —
// display name and phone number. Email lives in `auth.users`, not
// `profiles`, and isn't edited here: the PRD's own source flow persists
// email changes with no verification step at all ("a user can change
// their own email to anything"), and this prompt's scope is explicitly
// "profiles fields", not a re-implementation of that unverified email
// flow. Password change already lives at /change-password (Prompt 2) —
// out of scope here too. A single self-write covered entirely by the
// "profiles_update_own" RLS policy (0003) — no RPC needed (R4 only
// requires a transaction for multi-field edits that need one; this is
// one UPDATE against one row the caller already owns).
export default function UserProfilePage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const profileQueryKey = ["profile", "self"] as const;

  const profileQuery = useQuery({
    queryKey: profileQueryKey,
    queryFn: async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("not signed in");

      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, phone_number")
        .eq("user_id", userData.user.id)
        .single();
      if (error) throw error;
      return { displayName: data.display_name, phoneNumber: data.phone_number } as ProfileRow;
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.displayName);
      setPhoneNumber(profileQuery.data.phoneNumber ?? "");
    }
  }, [profileQuery.data]);

  const saveOptimistic = optimisticUpdate<ProfileRow, void>(queryClient, profileQueryKey, (row) =>
    row
      ? { displayName: displayName.trim(), phoneNumber: phoneNumber.trim() || null }
      : row,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("not signed in");

      const trimmedName = displayName.trim();
      if (!trimmedName) throw new Error("שם התצוגה לא יכול להיות ריק");

      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmedName, phone_number: phoneNumber.trim() || null })
        .eq("user_id", userData.user.id);
      if (error) throw error;
    },
    onMutate: saveOptimistic.onMutate,
    onSuccess: () => {
      showToast("הפרופיל נשמר.", "success");
      void queryClient.invalidateQueries({ queryKey: profileQueryKey });
    },
    onError: mergeOnError(saveOptimistic.onError, (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  function handleCancel() {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.displayName);
      setPhoneNumber(profileQuery.data.phoneNumber ?? "");
    }
  }

  if (profileQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // A failed read left the form rendering with empty inputs — indistinguishable
  // from a profile that genuinely has no name on file, and one Save away from
  // the user "correcting" it and overwriting their real phone number with
  // nothing. Refusing to render the form is the only safe answer.
  if (profileQuery.isError) {
    return (
      <QueryError
        what="הפרופיל"
        onRetry={() => void profileQuery.refetch()}
        retrying={profileQuery.isFetching}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="פרופיל משתמש"
        subtitle="שם התצוגה והטלפון שלך. שינוי סיסמה מתבצע בנפרד, במסך קביעת הסיסמה."
      />
      <Card padded={false}>
        {/* An identity banner above the fields. This page is about "you", and
            a form with no subject at the top of it is just two inputs — the
            avatar and name give it one. */}
        <div className="flex items-center gap-4 border-b border-border bg-surface-muted/60 px-6 py-5">
          <span
            aria-hidden
            className="font-display flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xl text-accent ring-1 ring-inset ring-accent/25"
          >
            {displayName.trim().charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{displayName || "—"}</p>
            <p className="mt-0.5 truncate text-sm text-ink-muted">{phoneNumber || "ללא טלפון"}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-6">
          <FormSection title="פרטים אישיים">
            <FormField label="שם תצוגה" htmlFor="displayName">
              <input
                id="displayName"
                type="text"
                required
                className={`${inputClassName} w-full`}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FormField>

            <FormField label="טלפון" htmlFor="phoneNumber">
              <input
                id="phoneNumber"
                type="tel"
                className={`${inputClassName} w-full`}
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
              />
            </FormField>
          </FormSection>

          <div className="flex gap-2">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && (
                <span
                  aria-hidden
                  className="animate-spin-loop h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {saveMutation.isPending ? "שומר…" : "שמור"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={saveMutation.isPending}
            >
              ביטול
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
