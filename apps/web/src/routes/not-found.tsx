import { Link } from "react-router-dom";

// Styled with the app's own tokens rather than the inline `style` block it
// had before — a 404 is still a screen of this product, and an unstyled one
// reads as a crash rather than as a wrong address.
//
// The source's 404 is a single text element with no navigation on it
// (reference/prd/pages/404.md). The link back to "/" added here is not a
// content change of substance: "/" is HomeRedirect, which sends each role to
// its own landing screen, so this is the same dead end with a way out of it.
// A 404 with no exit is the one place a user can get genuinely stuck.
export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-canvas px-4 text-center">
      {/* The numeral is set so large it reads as a graphic rather than as
          text — which is also why it sits outside the app's three-size type
          scale: it illustrates what happened rather than being a line anyone
          reads. It uses the faintest ink on the page, so the sentence under
          it is what you actually read. */}
      <p
        aria-hidden
        className="font-display pointer-events-none select-none text-[5.5rem] leading-none text-border-strong/70 sm:text-[9rem] md:text-[12rem]"
      >
        404
      </p>
      <h1 className="font-display -mt-4 text-2xl text-ink">הדף לא נמצא.</h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-muted">
        ייתכן שהכתובת שגויה, או שהדף הוסר.
      </p>
      <Link
        to="/"
        className="mt-7 inline-flex h-10 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-ink shadow-accent transition-colors duration-200 hover:bg-accent-hover"
      >
        חזרה לדף הבית
      </Link>
    </main>
  );
}
