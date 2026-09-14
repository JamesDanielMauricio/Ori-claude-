// GPU-composited loading placeholder. The sweep is a translated overlay
// (`transform`, animated in globals.css's `shimmer-sweep` keyframes), never
// a `background-position` tween or SVG SMIL `<animate>` — both of those
// force the browser to repaint on the main thread every frame, which is
// exactly what made the source app's tab switches and loading states
// janky (see the "Performance Issues" findings, Issue 1). `overflow-hidden`
// clips the sweep to the skeleton's own box so nothing needs repainting
// outside it.
//
// The base is a flat `border`-toned fill: a skeleton has to stay visible on
// both the white surfaces and the canvas it gets rendered on, and anything
// lighter than this disappears against a card. The sweep is now angled
// (`-skew-x-12`, and wider than the box it crosses) rather than a straight
// vertical band — a diagonal highlight reads as light moving across a
// surface, where a hard vertical edge reads as a rendering artifact.
//
// The highlight is its own `shimmer` token rather than white: a sweep that
// reads as light on paper is a glaring stripe on a dark surface.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-border/70 ${className}`}
      // Placeholders are not content. Without this a screen reader announces
      // a run of empty boxes between the heading and the real data.
      aria-hidden
    >
      <div className="animate-shimmer-sweep absolute inset-y-0 -inset-x-1/4 -skew-x-12 bg-gradient-to-r from-transparent via-shimmer to-transparent" />
    </div>
  );
}
