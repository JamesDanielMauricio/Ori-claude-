import { useEffect, useState } from "react";

// Decides a layout breakpoint in JS and returns which side of it the
// viewport is currently on — for the (several) places in this app that
// render two structurally different layouts (a mobile card list vs. a
// desktop table/grid) rather than one layout hidden/shown with CSS. Deciding
// once, in JS, and mounting only the layout that's actually showing avoids
// doubling the DOM/accessibility tree — see two-column-row-list.tsx's own
// comment, the first place this pattern was needed, for the full reasoning.
export function useWide(query: string): boolean {
  // Read synchronously on first render rather than defaulting to `false` and
  // correcting in an effect: this is a plain client-rendered SPA (no SSR
  // pass to mismatch against), so there is nothing to lose and a real flash
  // of the wrong layout to avoid.
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setWide(mql.matches);
    // Re-sync in case `query` changed between mounts, or the browser's
    // reported state moved between the initializer above and this effect
    // attaching.
    setWide(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return wide;
}
