import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";

import { FormField } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc-client";

interface ResettableUser {
  user_id: string;
  display_name: string;
  phone_number: string | null;
  companies: { name: string } | null;
}

// Last four digits of a phone as typed on the profile — enough to confirm
// it's the right person without printing the whole number on screen.
function lastFourDigits(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// Admin-mediated reset: the backoffice picks a user, and apps/api sends that
// user a one-time link on WhatsApp — to the phone on their own profile — and
// signs them out everywhere (packages/domain/src/auth/admin-reset-password.ts).
// The link itself is never shown here.
export default function AdminResetPasswordPage() {
  const supabase = createClient();
  const { user } = useAuth();
  const [targetUserId, setTargetUserId] = useState("");
  const resetPassword = trpc.auth.adminResetPassword.useMutation();

  // Readable by backoffice through the "profiles_select_backoffice" policy.
  const usersQuery = useQuery({
    queryKey: ["users-reset", "users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, phone_number, companies(name)")
        .order("display_name");
      if (error) throw error;
      return data as unknown as ResettableUser[];
    },
  });
  // Shown beside the chosen user so two people with the same name can be
  // told apart. Optional: the reset works without it.
  const emailsQuery = trpc.auth.listUserEmails.useQuery();

  // The signed-in admin is left out: resetting your own account here would
  // sign you out mid-flow, and the server refuses it anyway.
  const options = useMemo(
    () => [
      { value: "", label: "בחר משתמש", disabled: true },
      ...(usersQuery.data ?? [])
        .filter((row) => row.user_id !== user?.id)
        .map((row) => ({
          value: row.user_id,
          label: row.companies?.name ? `${row.display_name} — ${row.companies.name}` : row.display_name,
        })),
    ],
    [usersQuery.data, user?.id],
  );

  const selected = usersQuery.data?.find((row) => row.user_id === targetUserId) ?? null;
  const selectedDigits = lastFourDigits(selected?.phone_number ?? null);

  function handleSelect(next: string) {
    setTargetUserId(next);
    // A result belongs to the user it was for — don't leave it on screen
    // under a different name.
    resetPassword.reset();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    resetPassword.mutate({ targetUserId: selected.user_id });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="איפוס סיסמה למשתמש"
        subtitle="שולח למשתמש ב-WhatsApp, למספר הטלפון שבפרופיל שלו, קישור חד-פעמי לקביעת סיסמה חדשה. הקישור לא מוצג כאן. המשתמש מנותק מכל המכשירים שבהם הוא מחובר ויתבקש לקבוע סיסמה חדשה."
      />

      <Card className="max-w-md">
        {usersQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : usersQuery.isError ? (
          <QueryError
            what="רשימת המשתמשים"
            onRetry={() => void usersQuery.refetch()}
            retrying={usersQuery.isFetching}
          />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <FormField label="משתמש" htmlFor="targetUser">
              <Select
                id="targetUser"
                aria-label="משתמש"
                className="w-full"
                value={targetUserId}
                onChange={handleSelect}
                options={options}
              />
            </FormField>

            {selected && (
              <div className="flex flex-col gap-1.5 text-sm">
                {emailsQuery.data?.[selected.user_id] && (
                  <p className="text-ink-muted" dir="ltr">
                    {emailsQuery.data[selected.user_id]}
                  </p>
                )}
                {selectedDigits ? (
                  <p className="text-ink-muted">
                    הקישור יישלח ב-WhatsApp למספר המסתיים ב-
                    <span dir="ltr" className="font-semibold text-ink">
                      {selectedDigits}
                    </span>
                    .
                  </p>
                ) : (
                  <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-warning ring-1 ring-inset ring-warning/20">
                    <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
                    למשתמש אין מספר טלפון בפרופיל, ולכן אי אפשר לשלוח לו את הקישור. הוסף מספר במסך
                    המשתמשים.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={resetPassword.isPending || !selected || !selectedDigits}
              className="self-start"
            >
              {resetPassword.isPending && (
                <span
                  aria-hidden
                  className="animate-spin-loop h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {resetPassword.isPending ? "שולח…" : "שלח קישור לאיפוס"}
            </Button>

            {/* Outcome banners get an icon and a tinted rule, matching the
                toast vocabulary. The success text is built from what the
                server reports it actually did, not from what was asked. */}
            {resetPassword.isSuccess &&
              (resetPassword.data.devRedirected ? (
                <p className="flex items-start gap-2.5 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning ring-1 ring-inset ring-warning/20">
                  <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
                  <span>
                    המערכת במצב פיתוח: הקישור נשלח למספר הבדיקה (המסתיים ב-
                    <span dir="ltr">{resetPassword.data.lastDigits}</span>) ולא למשתמש. המשתמש נותק
                    ויתבקש לקבוע סיסמה חדשה.
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-2.5 rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent ring-1 ring-inset ring-accent/20">
                  <Icon name="checkCircle" className="mt-px h-4 w-4 shrink-0" />
                  <span>
                    הקישור נשלח ב-WhatsApp למספר המסתיים ב-
                    <span dir="ltr">{resetPassword.data.lastDigits}</span>. המשתמש נותק מכל
                    המכשירים ויתבקש לקבוע סיסמה חדשה.
                  </span>
                </p>
              ))}
            {resetPassword.isError && (
              <p
                role="alert"
                className="flex items-start gap-2.5 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/20"
              >
                <Icon name="alertCircle" className="mt-px h-4 w-4 shrink-0" />
                {resetPassword.error.message}
              </p>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
