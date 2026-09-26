import { useEffect, useState, type RefObject } from "react";

/**
 * Keeps a popup on screen for as long as its closing animation takes.
 *
 * React removes an element the moment the state showing it turns false, which
 * leaves nothing on screen to animate — so a popup written the obvious way
 * (`{open && <Panel />}`) can animate in but never out. This sits between
 * `open` and the render: once `open` turns false it reports `closing` while
 * the element's CSS exit animation runs, and only then lets `present` go
 * false.
 *
 * The caller renders while `present`, and marks the element with
 * `data-closing` while `closing` — that attribute is what globals.css hangs
 * each popup's exit animation on.
 *
 * The animation lives entirely in the stylesheet; this hook never knows how
 * long it is. It asks the browser which animations are running on the
 * element and waits for them to finish, so changing a duration in CSS needs
 * no matching change here, and the reduced-motion rule (which cuts every
 * animation to ~0ms) makes the wait ~0 too.
 */
export function useExitAnimation(open: boolean, ref: RefObject<Element | null>) {
  const [closing, setClosing] = useState(false);
  const [previousOpen, setPreviousOpen] = useState(open);

  // Adjusted during render, not in an effect. An effect would run only after
  // React had already rendered the popup as gone — `present` false for one
  // frame, the element unmounted, nothing left to animate. Reopening
  // mid-exit clears `closing` the same way, so the entrance plays again.
  if (open !== previousOpen) {
    setPreviousOpen(open);
    setClosing(!open);
  }

  useEffect(() => {
    if (!closing) return;
    // getAnimations() brings the element's styles up to date before it
    // answers, so it already sees the exit animation `data-closing` started.
    // `allSettled`, not `all`: an animation cancelled part-way (the popup was
    // reopened, or hidden some other way) rejects its `finished` promise,
    // and that still means "stop waiting".
    const animations = ref.current?.getAnimations() ?? [];
    let cancelled = false;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) setClosing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [closing, ref]);

  return { present: open || closing, closing };
}
