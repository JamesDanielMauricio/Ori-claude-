import { useState, type FormEvent } from "react";

import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc-client";

export default function AdminResetPasswordPage() {
  const [targetUserId, setTargetUserId] = useState("");
  const resetPassword = trpc.auth.adminResetPassword.useMutation();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    resetPassword.mutate({ targetUserId });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="איפוס סיסמה למשתמש"
        subtitle="מפיק קישור חד-פעמי ושולח אותו ישירות למשתמש — הקישור לעולם לא מוצג כאן. המשתמש מנותק מכל התחברות קיימת ויידרש לקבוע סיסמה חדשה בכניסה הבאה."
      />

      <Card className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <FormField label="מזהה משתמש" htmlFor="targetUserId">
            <input
              id="targetUserId"
              required
              placeholder="UUID של המשתמש"
              dir="ltr"
              className={`${inputClassName} w-full text-left font-mono text-xs`}
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
            />
            {/* Known UX gap, documented in UAT_CHECKLIST.md § 5: a raw UUID,
                not a name/email picker — stated inline rather than hidden. */}
            <p className="mt-1.5 text-xs text-ink-muted">
              את המזהה ניתן להעתיק מרשימת המשתמשים במסך &quot;משתמשים&quot;.
            </p>
          </FormField>

          <Button type="submit" disabled={resetPassword.isPending} className="self-start">
            {resetPassword.isPending && (
              <span
                aria-hidden
                className="animate-spin-loop h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {resetPassword.isPending ? "שולח…" : "שלח קישור לאיפוס"}
          </Button>

          {/* Outcome banners get an icon and a tinted rule, matching the
              toast vocabulary — previously two bare tinted paragraphs that
              were easy to miss under a button. */}
          {resetPassword.isSuccess && (
            <p className="flex items-start gap-2.5 rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent ring-1 ring-inset ring-accent/20">
              <Icon name="checkCircle" className="mt-px h-4 w-4 shrink-0" />
              הקישור הופק ונשלח למשתמש.
            </p>
          )}
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
      </Card>
    </div>
  );
}
