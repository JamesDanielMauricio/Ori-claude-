import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

// Keeps screens current without Supabase Realtime and without any timer: the
// moment someone comes BACK to the app, everything on their screen is re-read.
// That is when stale data would actually be seen — nobody reads a screen
// they're not looking at — so a person who opens a trading day on one device
// is seen by growers and customers the next time they look at theirs, without
// anyone pressing reload.
//
// "Coming back" is any of:
//   - the tab or installed app is shown again (a phone unlocked, a tab
//     switched back to, a minimized window restored);
//   - the browser window gets focus back (clicking into it from another
//     program — on a desktop the tab can stay "shown" the whole time);
//   - the device comes back online;
//   - the first tap, click or keypress after AWAY_AFTER_MS of none (someone
//     who left the screen up and walked away, then returns to it).
//
// What this can't catch: someone staring at a screen without touching it
// while another person changes something. They see it on their next touch
// or return. That is the price of having no timer and no push connection;
// James chose it over both (2026-09-29).
//
// Cost: one re-read of the screen per return — ~5 KB for the grower's picks
// screen, ~12 KB for the customer's order screen, ~31 KB for the arrangement
// board (measured 2026-09-29, compressed). Nothing at all runs while nobody
// is using the app: no interval, no open connection.
//
// Mounted once for the whole app, in main.tsx.

// How long without a single tap, click or keypress counts as "away".
// Someone working touches the screen every few seconds, and their own saves
// already refresh what they changed; a full minute without one means they
// looked away or were waiting.
const AWAY_AFTER_MS = 60_000;

// Coming back usually fires several of the signals above at once — switching
// to a tab is both "shown" and "focused", and a click often follows — and
// this makes them one refresh. It also stops rapid back-and-forth tab
// switching from re-reading on every flip.
const SAME_RETURN_MS = 5_000;

export function RefreshOnReturn() {
  const queryClient = useQueryClient();
  useEffect(() => watchForReturns(queryClient), [queryClient]);
  return null;
}

// Exported for refresh-on-return.test.ts; the app only uses <RefreshOnReturn />.
// Returns the function that stops watching.
export function watchForReturns(queryClient: QueryClient): () => void {
  // Starts as "just refreshed": the screen's data was loaded moments ago.
  let lastRefresh = Date.now();
  let lastActivity = Date.now();

  function refresh() {
    // A hidden tab has nobody to show fresh data to; being shown again is
    // itself a return and refreshes then.
    if (document.visibilityState === "hidden") return;
    // Not while this device is saving something. The optimistic updates
    // (lib/optimistic-mutation.ts) show a click's result before the server
    // confirms it, and a re-read landing before the save commits would flash
    // the old value over it. The save refreshes its own data when it lands.
    if (queryClient.isMutating() > 0) return;
    const now = Date.now();
    if (now - lastRefresh < SAME_RETURN_MS) return;
    lastRefresh = now;
    // Every query: those on screen are re-read now, the rest are marked out
    // of date and re-read when a screen next shows them. Deliberately not a
    // hand-picked list — a screen missing from such a list is how data went
    // stale before. `cancelRefetch: false` leaves a read already in flight
    // alone instead of starting it over.
    void queryClient.invalidateQueries(undefined, { cancelRefetch: false });
  }

  function onVisibilityChange() {
    if (document.visibilityState === "visible") refresh();
  }

  function onActivity() {
    const now = Date.now();
    const wasAway = now - lastActivity >= AWAY_AFTER_MS;
    lastActivity = now;
    if (wasAway) refresh();
  }

  // Capture phase, so a component that stops a click from bubbling still
  // counts as activity; passive, so listening never delays a scroll or tap.
  const activityOptions: AddEventListenerOptions = { capture: true, passive: true };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  window.addEventListener("pointerdown", onActivity, activityOptions);
  window.addEventListener("keydown", onActivity, activityOptions);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("online", refresh);
    window.removeEventListener("pointerdown", onActivity, activityOptions);
    window.removeEventListener("keydown", onActivity, activityOptions);
  };
}
