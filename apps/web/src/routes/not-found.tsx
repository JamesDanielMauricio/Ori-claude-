// Styled with the app's own tokens rather than the inline `style` block it
// had before — a 404 is still a screen of this product, and an unstyled one
// reads as a crash rather than as a wrong address. Content is unchanged:
// the source's 404 is a single text element with no navigation on it
// (reference/prd/pages/404.md), so this doesn't add a link it never had.
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-4 text-center">
      <p aria-hidden className="text-6xl font-bold tracking-tight text-accent-soft">
        404
      </p>
      <p className="text-lg font-semibold text-ink">הדף לא נמצא.</p>
    </div>
  );
}
