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
    // They follow the light/dark theme like every other page: the field is
    // the page's own `canvas` and the card a `surface` lifted off it, so
    // signing in looks like the app you land in afterwards. The theme is the
    // choice saved in this browser, or the device setting — and index.html
    // applies it before first paint on these screens too, so there's no flash.
    //
    // No `data-surface`. These screens used to borrow the sidebar's dark
    // palette to stay dark in both themes; following the theme, the plain
    // page tokens are exactly right, and the shared inputs and Button inside
    // `children` match every other form in the app.
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-canvas px-4 py-10 text-ink">
      {/* One static emerald bloom above the card. Nothing here animates, so
          the compositor paints it once and never again. Mixed from the
          accent token rather than written as a fixed colour, so it follows
          the theme: the brand green on paper, the brighter green in dark
          mode. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(60rem_30rem_at_50%_-22%,color-mix(in_oklab,var(--color-accent-bright)_14%,transparent),transparent_70%)]"
      />
      {/* A faint dot grid, masked to fade out at the edges, so the empty
          space has a texture to sit on rather than being flat. Drawn in
          `ink` at 7%, so the dots come out dark on paper and light on dark. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(color-mix(in_oklab,var(--color-ink)_7%,transparent)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(44rem_30rem_at_50%_45%,#000,transparent_78%)]"
      />

      <div className="animate-rise-in relative flex w-full max-w-sm flex-col items-center">
        <div className="mb-8 flex items-center gap-2.5">
          {/* The same mark and wordmark the sidebar carries, at the same size,
              so signing in and the app share one lockup. It deliberately
              doesn't lead: the form's title below is this screen's one 24px
              line, and a brand name above it at the same size (or, as it was,
              larger) split attention between two headings. Outlined, not
              filled: a hairline reads as considered, where a solid chip
              reads as a logo placeholder. */}
          <span
            aria-hidden
            className="flex h-9 w-9 select-none items-center justify-center rounded-lg text-sm font-semibold text-accent ring-1 ring-inset ring-accent/40"
          >
            א
          </span>
          <p className="text-sm font-semibold text-ink">אורי והבננות</p>
        </div>

        {/* The card is a panel lifted off the field — one step lighter (white
            on paper, a charcoal step up in dark mode), with a hairline and a
            large soft shadow, exactly as cards sit on every other page.
            Slightly translucent and blurred, so the dot grid softens into it
            instead of stopping at a hard edge. */}
        <div className="w-full rounded-xl bg-surface/85 p-8 shadow-overlay ring-1 ring-inset ring-border backdrop-blur-sm">
          <h1 className="font-display text-2xl text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </main>
  );
}
