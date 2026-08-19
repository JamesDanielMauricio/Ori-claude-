import type { ReactNode } from "react";

// The unauthenticated pages' shared frame (login / reset-password /
// change-password): per the PRD's Login doc, these pages carry none of
// the app's chrome — no header, no sidebar — just a centered card with
// the product name above it. One component so all three stay identical.
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <p className="mb-6 text-2xl font-bold tracking-tight text-accent">אורי והבננות</p>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}
