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
// lighter than this disappears against a card.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-border/80 ${className}`}>
      <div className="animate-shimmer-sweep absolute inset-0 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}
