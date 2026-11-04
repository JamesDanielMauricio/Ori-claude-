import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { CORNER_GUTTER, THUMB_INSET, clamp } from "./geometry";
import type { useMatrixScroll } from "./use-matrix-scroll";

type ScrollState = ReturnType<typeof useMatrixScroll>;

// The matrix's two custom scrollbar thumbs — siblings of the scrollport,
// never children of it, so scrolling the table can't carry them away.
// Dragging one writes the scrollport's scroll position directly; the
// scroll listener in useMatrixScroll turns that back into `range` and the
// thumbs' geometry, one path for every way the list can move.
export function MatrixScrollbars({
  scrollRef,
  thumbGeo,
  hThumbGeo,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  thumbGeo: ScrollState["thumbGeo"];
  hThumbGeo: ScrollState["hThumbGeo"];
}) {
  // Drag state for both thumbs, as refs rather than state: they change on
  // every pointermove, and none of those frames need to trigger a React
  // render — dragging only ever ends up mutating `element.scrollTop` /
  // `scrollLeft` directly (see the two handlePointerMove functions), and the
  // scroll listener already in place below is what turns that back into
  // `range`/`thumbGeo`/`hThumbGeo` updates.
  const dragRef = useRef<{
    startY: number;
    startScrollTop: number;
    scrollable: number;
    trackHeight: number;
  } | null>(null);
  const hDragRef = useRef<{
    startX: number;
    startScrollLeft: number;
    scrollable: number;
    trackWidth: number;
  } | null>(null);

  // ---- the custom thumb --------------------------------------------------
  // Dragging never touches React state directly: it writes `scrollTop` on
  // the real element, and the `scroll` listener the virtualiser already
  // owns (above) is what turns that back into a re-measured `range` and
  // `thumbGeo` — one path for "the list moved," whether a wheel, a keypress
  // or this drag caused it.
  function handleThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    if (!element || !thumbGeo) return;
    // Stops the pointer-down from also landing as a text-selection drag or
    // stealing focus from whatever cell was being edited.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Mirrors `measure()`'s own track-height formula (use-matrix-scroll.ts) exactly — the corner
    // gutter has to match what's actually rendered, or the last few pixels
    // of a drag would move the thumb faster or slower than the cursor.
    const trackHeightFull =
      element.clientHeight - THUMB_INSET - (hThumbGeo ? CORNER_GUTTER : THUMB_INSET);
    dragRef.current = {
      startY: event.clientY,
      startScrollTop: element.scrollTop,
      scrollable: element.scrollHeight - element.clientHeight,
      // The distance the thumb's OWN top can travel — not the full track —
      // which is what makes a pixel of mouse movement equal a pixel of
      // thumb movement instead of overshooting by the thumb's own height.
      trackHeight: Math.max(0, trackHeightFull) - thumbGeo.height,
    };
  }

  function handleThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const element = scrollRef.current;
    if (!drag || !element || drag.trackHeight <= 0) return;
    const dy = event.clientY - drag.startY;
    const scrollDelta = (dy / drag.trackHeight) * drag.scrollable;
    element.scrollTop = clamp(drag.startScrollTop + scrollDelta, 0, drag.scrollable);
  }

  function handleThumbPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Same shape as the three above, mirrored onto `scrollLeft`. The one
  // difference that isn't just s/Top/Left/ — the clamp range: RTL's
  // `scrollLeft` runs `-scrollable..0`, not `0..scrollable`.
  function handleHThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    if (!element || !hThumbGeo) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Mirrors `measure()`'s own track-width formula (use-matrix-scroll.ts) — see the vertical
    // handler above for why this has to match exactly.
    const leftMin = thumbGeo ? CORNER_GUTTER : THUMB_INSET;
    const trackWidthFull = element.clientWidth - THUMB_INSET - leftMin;
    hDragRef.current = {
      startX: event.clientX,
      startScrollLeft: element.scrollLeft,
      scrollable: element.scrollWidth - element.clientWidth,
      trackWidth: Math.max(0, trackWidthFull) - hThumbGeo.width,
    };
  }

  function handleHThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = hDragRef.current;
    const element = scrollRef.current;
    if (!drag || !element || drag.trackWidth <= 0) return;
    const dx = event.clientX - drag.startX;
    const scrollDelta = (dx / drag.trackWidth) * drag.scrollable;
    element.scrollLeft = clamp(drag.startScrollLeft + scrollDelta, -drag.scrollable, 0);
  }

  function handleHThumbPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hDragRef.current) return;
    hDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <>
      {/* The custom thumb — a sibling of the scrollport above, not a child of
          it, so scrolling the table never carries it away with the content.
          Absent entirely when the list already fits (`thumbGeo` null),
          matching a native scrollbar's own "nothing to show" behaviour. */}
      {thumbGeo && (
        <div
          role="scrollbar"
          aria-orientation="vertical"
          aria-controls="arrangement-matrix-scrollport"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={thumbGeo.percent}
          aria-label="גלילה אנכית"
          // The page is RTL, and every screenshot of this grid has shown the
          // browser's own vertical scrollbar landing on the left for exactly
          // that reason — matching it here is what makes this read as "the
          // scrollbar" rather than as a stray decoration.
          style={{ left: 4, top: thumbGeo.top, height: thumbGeo.height }}
          className="absolute w-2 cursor-grab touch-none rounded-full bg-border-strong/80 transition-colors duration-150 hover:bg-ink-subtle active:cursor-grabbing active:bg-ink-subtle"
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
        />
      )}

      {/* Same idea, horizontal — bottom edge instead of left, `width`
          instead of `height`. See `hThumbGeo`'s own comment for the RTL
          progress maths this position is built from. */}
      {hThumbGeo && (
        <div
          role="scrollbar"
          aria-orientation="horizontal"
          aria-controls="arrangement-matrix-scrollport"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={hThumbGeo.percent}
          aria-label="גלילה אופקית"
          style={{ bottom: 4, left: hThumbGeo.left, width: hThumbGeo.width }}
          className="absolute h-2 cursor-grab touch-none rounded-full bg-border-strong/80 transition-colors duration-150 hover:bg-ink-subtle active:cursor-grabbing active:bg-ink-subtle"
          onPointerDown={handleHThumbPointerDown}
          onPointerMove={handleHThumbPointerMove}
          onPointerUp={handleHThumbPointerUp}
        />
      )}
    </>
  );
}
