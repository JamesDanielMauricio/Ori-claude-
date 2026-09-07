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
    // These three screens are the only ones with a single small object on an
    // otherwise empty viewport, so they are the one place the background has
    // to do real work — everywhere else, content fills the page.
    //
    // The whole field is dark here, not paper: it's the same forest as the
    // app's rail, so signing in hands you straight into the product's own
    // color world instead of a white page that looks like a different app.
    // `data-surface="rail"` gives this subtree the dark token set, so the
    // shared inputs and Button inside `children` come out dark without any
    // auth-specific styling (see globals.css).
    <main
      data-surface="rail"
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-surface px-4 py-10 text-ink"
    >
      {/* Two static washes — a green bloom above, a brass one low and to the
          inline-start. Nothing here animates, so the compositor paints it
          once and never again. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(60rem_30rem_at_50%_-22%,rgb(67_173_110/0.18),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -start-40 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgb(217_172_78/0.10),transparent_66%)]"
      />
      {/* A faint dot grid, masked to fade out at the edges, so the empty
          space has a texture to sit on rather than being flat black. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(44rem_30rem_at_50%_45%,#000,transparent_78%)]"
      />

      <div className="animate-rise-in relative flex w-full max-w-sm flex-col items-center">
        <div className="mb-8 flex items-center gap-3">
          {/* Brass outline, display serif — the same mark the rail carries, at
              a size where it can lead. No gradient fill: a metallic hairline
              on dark is what reads as considered, where a glowing green chip
              reads as a startup logo placeholder. */}
          <span
            aria-hidden
            className="font-display flex h-12 w-12 select-none items-center justify-center rounded-xl text-2xl text-brass ring-1 ring-inset ring-brass/45"
          >
            א
          </span>
          <p className="font-display text-3xl text-ink">אורי והבננות</p>
        </div>

        {/* The card is a lifted panel of the same family as the field, not a
            white sheet dropped on it — separated by a hairline and a large
            soft shadow rather than by inverting the value. */}
        <div className="w-full rounded-xl bg-surface-muted/80 p-8 shadow-overlay ring-1 ring-inset ring-border backdrop-blur-sm">
          <h1 className="font-display text-2xl text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </main>
  );
}
