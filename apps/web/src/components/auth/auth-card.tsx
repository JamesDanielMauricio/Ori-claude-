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
    // A soft accent wash behind the card, rather than the flat canvas. These
    // three screens are the only ones with a single small object on an
    // otherwise empty viewport, so they are the one place the background has
    // to do some work — everywhere else, content fills the page.
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-accent-soft to-transparent"
      />

      <div className="relative flex w-full max-w-sm flex-col items-center">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-10 w-10 select-none items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-ink shadow-card"
          >
            א
          </span>
          <p className="text-2xl font-bold tracking-tight text-ink">אורי והבננות</p>
        </div>

        <div className="w-full rounded-xl border border-border bg-surface p-6 shadow-raised">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm leading-relaxed text-ink-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}
