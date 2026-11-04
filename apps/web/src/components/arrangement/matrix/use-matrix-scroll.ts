import { useEffect, useRef, useState } from "react";

import {
  CORNER_GUTTER,
  HEADER_H,
  MIN_THUMB_H,
  MIN_THUMB_W,
  OVERSCAN,
  ROW_H,
  THUMB_INSET,
  clamp,
} from "./geometry";

// The matrix's own scrollport and what follows from scrolling it: which
// rows are mounted (`range` — the virtualisation) and where both custom
// scrollbar thumbs sit. One scroll listener drives all three.
export function useMatrixScroll(rowCount: number) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The custom vertical thumb's own geometry — null when the list fits
  // without scrolling at all, in which case nothing is drawn. Kept as state
  // (not a ref) because it has to repaint the thumb; kept separate from
  // `range` even though both are written by the same `measure()` below,
  // because a search that shortens the list changes this without changing
  // which rows are rendered, and vice versa for a plain scroll.
  const [thumbGeo, setThumbGeo] = useState<{
    top: number;
    height: number;
    /** 0–100, for the thumb's `aria-valuenow` — how far down the list this is. */
    percent: number;
  } | null>(null);
  // Same idea, horizontal — the columns are ~1800px wide against a ~1260px
  // viewport, so this table needs a horizontal scrollbar too, and it gets
  // the identical custom treatment for the identical reason (see the
  // scrollport's own comment in arrangement-matrix.tsx). `left`/`width` rather than `right`, so
  // the maths is plain physical pixels-from-the-left regardless of the
  // page's RTL direction — only the PROGRESS calculation (in `measure`
  // below) has to account for RTL's negative `scrollLeft` convention.
  const [hThumbGeo, setHThumbGeo] = useState<{
    left: number;
    width: number;
    percent: number;
  } | null>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });

  // ---- virtualisation --------------------------------------------------
  // Measured off the scroll container rather than the window: the grid owns
  // its own scrollport (that is what makes `position: sticky` work without
  // guessing the page's offset), so the page's scroll position is irrelevant
  // here. Row `i` sits at HEADER_H + i * ROW_H in flow, and the sticky header
  // always covers the top HEADER_H of the viewport, so the first row visible
  // *below* the header is simply scrollTop / ROW_H.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const first = Math.floor(element.scrollTop / ROW_H);
      const visible = Math.ceil(Math.max(0, element.clientHeight - HEADER_H) / ROW_H);
      const start = Math.max(0, first - OVERSCAN);
      const end = Math.min(rowCount, first + visible + OVERSCAN);
      // Same-range guard: a scroll event fires per frame, and re-rendering
      // the grid for a range it already has is the one thing that would make
      // scrolling this cheap grid expensive again.
      setRange((current) =>
        current.start === start && current.end === end ? current : { start, end },
      );

      // Both thumbs, computed off the SAME scroll tick — one listener
      // driving both, rather than a second effect duplicating it.
      const scrollable = element.scrollHeight - element.clientHeight;
      const hScrollable = element.scrollWidth - element.clientWidth;

      if (scrollable <= 0) {
        // Nothing to scroll: no thumb, the same way a native scrollbar
        // simply isn't drawn when content already fits.
        setThumbGeo((current) => (current === null ? current : null));
      } else {
        const trackHeight = Math.max(
          0,
          element.clientHeight - THUMB_INSET - (hScrollable > 0 ? CORNER_GUTTER : THUMB_INSET),
        );
        const proportional = trackHeight * (element.clientHeight / element.scrollHeight);
        const height = clamp(proportional, MIN_THUMB_H, trackHeight);
        const top = THUMB_INSET + (element.scrollTop / scrollable) * (trackHeight - height);
        const percent = Math.round((element.scrollTop / scrollable) * 100);
        setThumbGeo((current) =>
          current && current.top === top && current.height === height && current.percent === percent
            ? current
            : { top, height, percent },
        );
      }

      // The horizontal thumb, same tick, same reasoning. The one real
      // difference is RTL's `scrollLeft`: 0 is the START (unscrolled — the
      // rightmost columns, since this page reads right to left) and it goes
      // NEGATIVE down to `-scrollable` at the far END, so `progress` has to
      // be built from `-scrollLeft` rather than read off it directly the
      // way `scrollTop` is above.
      if (hScrollable <= 0) {
        setHThumbGeo((current) => (current === null ? current : null));
      } else {
        // The vertical thumb's gutter is at the LEFT (its own home edge),
        // not the right, so only the left bound of this track moves.
        const leftMin = scrollable > 0 ? CORNER_GUTTER : THUMB_INSET;
        const leftMax = element.clientWidth - THUMB_INSET;
        const trackWidth = Math.max(0, leftMax - leftMin);
        const proportional = trackWidth * (element.clientWidth / element.scrollWidth);
        const width = clamp(proportional, MIN_THUMB_W, trackWidth);
        const progress = -element.scrollLeft / hScrollable;
        // 1 - progress: at progress 0 (start, unscrolled) the thumb sits at
        // the FAR end of its own travel — which in this RTL track is the
        // RIGHT side, i.e. the larger `left` value — and eases toward
        // `leftMin` as progress reaches 1.
        const left = leftMin + (1 - progress) * (trackWidth - width);
        const percent = Math.round(progress * 100);
        setHThumbGeo((current) =>
          current && current.left === left && current.width === width && current.percent === percent
            ? current
            : { left, width, percent },
        );
      }
    };
    // Coalesced into a frame: scroll fires far more often than the browser
    // paints, and each un-throttled handler would queue its own React render.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    // The visible row count changes with the window, not only with scrolling.
    const observer = new ResizeObserver(onScroll);
    observer.observe(element);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [rowCount]);

  return { scrollRef, range, thumbGeo, hThumbGeo };
}
