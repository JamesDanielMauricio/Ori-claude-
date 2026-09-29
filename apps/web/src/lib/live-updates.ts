import type { RealtimeChannel } from "@supabase/supabase-js";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "./auth-context";
import { createClient } from "./supabase/client";

// Keeps every screen live: when anyone changes data the app shows, every
// signed-in device that has the app ON SCREEN re-reads whatever it shows,
// within about a second — no reload, no timer.
//
// How: the database sends a tiny "something changed" message on one private
// Supabase Realtime channel whenever a transaction writes one of those tables
// (packages/db/migrations/0060_live-updates-broadcast.sql). This listens on
// that channel and, on any message, invalidates every React Query query. That
// refetches the ones currently mounted (i.e. on screen) and marks the rest
// stale, so they refetch the next time a screen mounts them — which is also
// what stops a screen reopened within the 30-second staleTime from showing
// data older than the last change.
//
// Only while the app is on screen. A tab in the background, a minimized
// window, a locked phone stops listening the moment it's hidden and starts
// again the moment it's shown (syncChannel, below) — Supabase counts a
// message for every device listening, looking or not, so a device nobody is
// looking at would otherwise cost one message per save all day for nothing.
//
// Cost: one message per save (not per changed row) + one per device that has
// the app on screen, against 2M (Free) / 5M (Pro) included a month — under
// ~30,000 a month at the busiest month on record (see the migration).
//
// Deliberately "refresh everything" rather than a map from table to the
// queries that read it. Such a map is exactly what went wrong before: each
// screen subscribed by hand to the tables its author thought of, and a screen
// that read a table it didn't listen to — the grower's picks screen, the Shop
// screen, both history screens — stayed stale until a reload. Refreshing
// everything can't miss a query, and is cheap where it counts: only queries
// on screen refetch, and React Query keeps the old object when refetched data
// is identical, so a screen whose data didn't change doesn't re-render.
//
// lib/refresh-on-return.ts runs alongside this and re-reads the screen the
// moment it's shown again, so what changed while it wasn't listening appears
// straight away.
//
// Mounted once for the whole app, in main.tsx.

// Must match what migration 0060's broadcast_table_changed() sends: topic,
// event, and private (its receive policy only admits signed-in users).
const TOPIC = "live-updates";
const CHANGED_EVENT = "changed";

// How long to collect messages before refreshing. Each save sends one message,
// but several people's saves often land together — a distributor working
// through the arrangement board, growers submitting at the start of the day —
// and this turns them into one refresh. Short enough that the change still
// appears to arrive immediately (people start to notice lag at around a
// second).
const REFRESH_DELAY_MS = 300;

// When the channel opens, Supabase first re-delivers ("replays") a message
// sent since a given moment, if there was one — 1 at most, since one is
// enough to say "re-read". This closes the gap between the moment a screen
// was read (page load, or refresh-on-return re-reading a tab shown again) and
// the moment the channel is listening, about a second later: a save landing
// in between would otherwise go unheard. It costs a re-read only when a save
// really did land in the window, not on every return.
//
// The moment is the later of two (see openChannel):
//   - when this sign-in's data started loading. Anything older is already in
//     that data, so replaying it would only waste a re-read on every page
//     load.
//   - REPLAY_WINDOW_MS ago. A minute, rather than just the second it takes to
//     connect, because a tab hidden for LESS than a minute may not be re-read
//     on return (its data can still be under the 30-second staleTime) — the
//     window reaches back past the moment it stopped listening, so anything
//     saved meanwhile is replayed. A tab hidden for longer is re-read on
//     return, because by then all its data is past the staleTime. And the
//     window is measured by this device's clock but compared against the
//     server's, so it also absorbs a device clock that runs up to half a
//     minute fast.
const REPLAY_WINDOW_MS = 60_000;

// The client to refresh while someone is signed in; undefined otherwise.
let signedInClient: QueryClient | undefined;
// When the current sign-in (or the session restored on page load) started —
// the moment its screens started reading their data.
let signedInAt = 0;
// A close still waiting for the server's goodbye (see syncChannel).
let closing: Promise<unknown> | undefined;

export function LiveUpdates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = user !== null;

  // No cleanup function, on purpose: the channel lives as long as someone is
  // signed in, not as long as this component happens to be mounted. React's
  // development mode mounts every component twice, and supabase-js returns
  // the SAME channel object for a topic that is still registered — removal
  // is asynchronous — so tearing down on unmount and re-creating on the
  // second mount would hand back a channel that is in the middle of closing
  // and would never receive anything. Starting is idempotent instead (see
  // startLiveUpdates), and only signing out stops it.
  useEffect(() => {
    if (signedIn) startLiveUpdates(queryClient);
    else stopLiveUpdates();
  }, [signedIn, queryClient]);

  return null;
}

function findChannel(): RealtimeChannel | undefined {
  // supabase-js prefixes every topic with "realtime:".
  return createClient()
    .getChannels()
    .find((channel) => channel.topic === `realtime:${TOPIC}`);
}

// Exported for live-updates.test.ts; the app only uses <LiveUpdates />.
export function startLiveUpdates(queryClient: QueryClient) {
  if (!signedInClient) {
    document.addEventListener("visibilitychange", syncChannel);
    signedInAt = Date.now();
  }
  signedInClient = queryClient;
  syncChannel();
}

export function stopLiveUpdates() {
  if (signedInClient) document.removeEventListener("visibilitychange", syncChannel);
  signedInClient = undefined;
  syncChannel();
}

// Opens or closes the channel to match the moment: open while someone is
// signed in and the app is on screen, closed otherwise.
//
// Closing is asynchronous — the channel stays registered with supabase-js
// until the server acknowledges it has left — and asking supabase-js for the
// topic in that window would hand back the closing channel, which never
// receives anything again. So while a close is in flight this leaves
// everything alone — no second close, no reopening onto the dying channel —
// and runs again once it's done: a tab hidden and shown again in quick
// succession ends up with a fresh channel.
function syncChannel() {
  if (closing) return;
  const channel = findChannel();
  const queryClient = document.visibilityState === "hidden" ? undefined : signedInClient;

  if (queryClient && !channel) {
    openChannel(queryClient);
  } else if (!queryClient && channel) {
    closing = createClient()
      .removeChannel(channel)
      .finally(() => {
        closing = undefined;
        // Only if it really closed. supabase-js unregisters the channel when
        // the server says goodbye, or when it gives up waiting; were a close
        // ever refused instead, trying again straight away would loop — the
        // next time the tab is hidden or shown tries again.
        if (findChannel() !== channel) syncChannel();
      });
  }
}

function openChannel(queryClient: QueryClient) {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let subscribedBefore = false;

  // Schedules one refresh REFRESH_DELAY_MS from the first message; messages
  // arriving in the meantime join it instead of pushing it back, so a steady
  // stream of changes can't postpone the refresh indefinitely.
  function refreshSoon() {
    if (refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refreshNow();
    }, REFRESH_DELAY_MS);
  }

  function refreshNow() {
    // Not while this device is saving something. The optimistic updates
    // (lib/optimistic-mutation.ts) show the result of a click before the
    // server confirms it; a refresh started now, triggered by someone ELSE's
    // change, could come back before this save commits and flash the old
    // value over the new one. Every save already refreshes its own data when
    // it finishes, so waiting costs nothing — the refresh just goes out after.
    //
    // And not while a read is already under way. It may have been answered
    // BEFORE the change this message is about, and React Query would hand
    // that answer to the refresh rather than ask again — leaving the screen
    // one change behind until the next one. Waiting for it to finish means
    // the refresh always asks after the change.
    if (queryClient.isMutating() > 0 || queryClient.isFetching() > 0) {
      refreshSoon();
      return;
    }
    // A tab hidden a moment ago, whose channel is still closing: nobody is
    // looking, so it downloads nothing. Its queries are only marked out of
    // date, and are re-read the moment the tab is shown again
    // (lib/refresh-on-return.ts, and React Query's own refetch-on-focus).
    const hidden = document.visibilityState === "hidden";
    void queryClient.invalidateQueries({ refetchType: hidden ? "none" : "active" });
  }

  createClient()
    .channel(TOPIC, {
      config: {
        private: true,
        broadcast: {
          replay: { since: Math.max(signedInAt, Date.now() - REPLAY_WINDOW_MS), limit: 1 },
        },
      },
    })
    .on("broadcast", { event: CHANGED_EVENT }, refreshSoon)
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Realtime only delivers messages sent while connected. When a
      // connection drops while the app is on screen (Wi-Fi blips, a laptop
      // lid closes) supabase-js reconnects by itself and reports SUBSCRIBED
      // again — but whatever changed in between was never heard, and the
      // replay above only reaches back from when the channel was OPENED. So
      // every SUBSCRIBED after the first means "possibly missed something":
      // refresh once to catch up. The first one needs nothing — the replay
      // covers everything since the screen's data was read.
      if (subscribedBefore) refreshSoon();
      subscribedBefore = true;
    });
}
