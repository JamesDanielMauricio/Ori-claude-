import { focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// A stand-in for the Supabase client's channel API: records the channels this
// module opens, and lets a test deliver a broadcast or a connection status to
// one the way supabase-js would.
interface FakeChannel {
  topic: string;
  params: { config?: { private?: boolean; broadcast?: unknown } };
  listeners: Array<{ type: string; event: string; callback: () => void }>;
  statusCallback?: (status: string) => void;
  on(type: string, filter: { event: string }, callback: () => void): FakeChannel;
  subscribe(callback: (status: string) => void): FakeChannel;
}

// Leaving a channel waits for the server's goodbye, and supabase-js keeps the
// channel registered until it arrives — as the real one does.
const LEAVE_MS = 50;

const fake = vi.hoisted(() => ({ channels: [] as unknown[], closes: 0 }));

vi.mock("./supabase/client", () => ({
  createClient: () => ({
    getChannels: () => fake.channels,
    channel: (topic: string, params: FakeChannel["params"]) => {
      const channel: FakeChannel = {
        topic: `realtime:${topic}`,
        params,
        listeners: [],
        on(type, filter, callback) {
          this.listeners.push({ type, event: filter.event, callback });
          return this;
        },
        subscribe(callback) {
          this.statusCallback = callback;
          return this;
        },
      };
      fake.channels.push(channel);
      return channel;
    },
    removeChannel: async (channel: unknown) => {
      fake.closes += 1;
      await new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
      fake.channels = fake.channels.filter((c) => c !== channel);
      return "ok";
    },
  }),
}));
// The component half reads the session; these tests drive start/stop directly.
vi.mock("./auth-context", () => ({ useAuth: () => ({ user: null }) }));

const { startLiveUpdates, stopLiveUpdates } = await import("./live-updates");

function onlyChannel(): FakeChannel {
  expect(fake.channels).toHaveLength(1);
  return fake.channels[0] as FakeChannel;
}

// What the database's trigger sends (migration 0060).
function broadcast(channel: FakeChannel) {
  for (const listener of channel.listeners) {
    if (listener.type === "broadcast" && listener.event === "changed") listener.callback();
  }
}

// A stand-in for the browser's document: a real EventTarget, so the module's
// listener fires exactly as it would on the real event.
let doc: EventTarget & { visibilityState: "visible" | "hidden" };

function setVisibility(state: "visible" | "hidden") {
  doc.visibilityState = state;
  doc.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
  fake.channels = [];
  fake.closes = 0;
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  vi.stubGlobal("document", doc);
});
afterEach(async () => {
  stopLiveUpdates();
  // Let any close finish, so the next test starts with none in flight.
  await vi.advanceTimersByTimeAsync(LEAVE_MS);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live updates", () => {
  let queryClient: QueryClient;
  let invalidate: MockInstance<QueryClient["invalidateQueries"]>;

  beforeEach(() => {
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  });

  it("joins the private live-updates channel, replaying from the moment of signing in", () => {
    startLiveUpdates(queryClient);
    const channel = onlyChannel();
    expect(channel.topic).toBe("realtime:live-updates");
    expect(channel.params.config).toEqual({
      private: true,
      // Nothing from before: whatever was saved earlier is already in the
      // data the screen is loading right now. And one message is enough to
      // know there's something to re-read.
      broadcast: { replay: { since: Date.now(), limit: 1 } },
    });
    expect(channel.listeners).toEqual([
      expect.objectContaining({ type: "broadcast", event: "changed" }),
    ]);
  });

  it("turns a burst of messages into ONE refresh of everything, 300ms later", async () => {
    startLiveUpdates(queryClient);
    const channel = onlyChannel();

    // Several people's saves landing together.
    for (let i = 0; i < 4; i++) broadcast(channel);
    await vi.advanceTimersByTimeAsync(299);
    expect(invalidate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    // No query filter: every query on screen, not a hand-picked list.
    expect(invalidate).toHaveBeenCalledWith({ refetchType: "active" });
  });

  it("is not pushed back by a steady stream of messages", async () => {
    startLiveUpdates(queryClient);
    const channel = onlyChannel();

    broadcast(channel);
    for (let elapsed = 0; elapsed < 300; elapsed += 100) {
      await vi.advanceTimersByTimeAsync(100);
      broadcast(channel);
    }
    // Refreshed 300ms after the FIRST message, and the ones that kept coming
    // in the meantime were folded into it.
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("waits while this device is saving, then refreshes", async () => {
    const isMutating = vi.spyOn(queryClient, "isMutating").mockReturnValue(1);
    startLiveUpdates(queryClient);
    broadcast(onlyChannel());

    await vi.advanceTimersByTimeAsync(900);
    expect(invalidate).not.toHaveBeenCalled();

    isMutating.mockReturnValue(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("waits for a read already under way, then refreshes", async () => {
    const isFetching = vi.spyOn(queryClient, "isFetching").mockReturnValue(1);
    startLiveUpdates(queryClient);
    broadcast(onlyChannel());

    await vi.advanceTimersByTimeAsync(900);
    expect(invalidate).not.toHaveBeenCalled();

    isFetching.mockReturnValue(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("catches up after a reconnect, but not on the first connect", async () => {
    startLiveUpdates(queryClient);
    const channel = onlyChannel();

    channel.statusCallback?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(1000);
    expect(invalidate).not.toHaveBeenCalled();

    // Wi-Fi blips while the app is on screen: the connection drops,
    // supabase-js reconnects by itself — and anything sent in between was
    // missed.
    channel.statusCallback?.("CHANNEL_ERROR");
    channel.statusCallback?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(300);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("opens one channel however often it is started, and signing out closes it", async () => {
    // React's development mode runs the starting effect twice.
    startLiveUpdates(queryClient);
    startLiveUpdates(queryClient);
    onlyChannel();

    stopLiveUpdates();
    await vi.advanceTimersByTimeAsync(LEAVE_MS);
    expect(fake.channels).toHaveLength(0);

    // Signing back in opens a fresh one.
    startLiveUpdates(queryClient);
    onlyChannel();
  });

  it("stops listening while the app is hidden, and listens again when it's shown", async () => {
    startLiveUpdates(queryClient);
    const before = onlyChannel();

    // The phone is locked, or another tab brought to the front.
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(LEAVE_MS);
    expect(fake.channels).toHaveLength(0);

    // Twenty minutes later it's looked at again: a fresh channel, replaying
    // from a minute before THIS moment.
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    setVisibility("visible");
    const after = onlyChannel();
    expect(after).not.toBe(before);
    expect(after.params.config?.broadcast).toEqual({
      replay: { since: Date.now() - 60_000, limit: 1 },
    });
  });

  it("hidden soon after signing in: replays from the sign-in, not a minute back", async () => {
    const signedInAt = Date.now();
    startLiveUpdates(queryClient);

    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(20_000);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(LEAVE_MS);

    // Everything from before the sign-in is in the data it loaded then.
    expect(onlyChannel().params.config?.broadcast).toEqual({
      replay: { since: signedInAt, limit: 1 },
    });
  });

  it("a page reloaded a moment after a save doesn't replay that save", async () => {
    // What an end-to-end test does: write its data, then load the page. The
    // save is 3 seconds older than the page load, so the page's own reads
    // already include it.
    const savedAt = Date.now();
    await vi.advanceTimersByTimeAsync(3000);
    startLiveUpdates(queryClient);
    const replay = (onlyChannel().params.config?.broadcast as { replay: { since: number } }).replay;
    expect(replay.since).toBeGreaterThan(savedAt);
  });

  it("hidden and shown again before the close finished: ends with one fresh channel", async () => {
    startLiveUpdates(queryClient);
    const before = onlyChannel();

    // A quick flick to another tab and back.
    setVisibility("hidden");
    setVisibility("visible");
    // The dying channel is still registered, and must not be mistaken for a
    // live one...
    expect(fake.channels).toEqual([before]);

    // ...so once it's gone, a new one replaces it.
    await vi.advanceTimersByTimeAsync(LEAVE_MS);
    const after = onlyChannel();
    expect(after).not.toBe(before);
  });

  it("asks to close only once, however often the app is hidden and shown meanwhile", async () => {
    startLiveUpdates(queryClient);
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(LEAVE_MS);
    expect(fake.closes).toBe(1);
    // And it ends up matching the latest state — hidden, so no channel.
    expect(fake.channels).toHaveLength(0);
  });

  it("signed in while hidden: opens nothing until the app is shown", () => {
    doc.visibilityState = "hidden";
    startLiveUpdates(queryClient);
    expect(fake.channels).toHaveLength(0);

    setVisibility("visible");
    onlyChannel();
  });

  it("stops watching the screen after signing out", async () => {
    startLiveUpdates(queryClient);
    stopLiveUpdates();
    await vi.advanceTimersByTimeAsync(LEAVE_MS);

    setVisibility("hidden");
    setVisibility("visible");
    expect(fake.channels).toHaveLength(0);
  });

  it("a message caught while the channel is closing only marks data out of date", async () => {
    startLiveUpdates(queryClient);
    const channel = onlyChannel();

    setVisibility("hidden");
    broadcast(channel);
    await vi.advanceTimersByTimeAsync(300);
    // Nobody is looking: nothing downloaded, re-read when shown again.
    expect(invalidate).toHaveBeenCalledWith({ refetchType: "none" });
  });
});

// Two things this module leans on are React Query's behavior, not ours, so
// they are checked against the real thing: no spies on the client.
describe("with the real React Query", () => {
  afterEach(() => {
    focusManager.setFocused(undefined);
  });

  it("a tab shown after more than the staleTime re-reads its screen by itself", async () => {
    // As the app configures it (lib/providers.tsx).
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    // What <QueryClientProvider> does in the app: starts listening for focus.
    queryClient.mount();
    const queryFn = vi.fn(async () => "open day");
    // A query on screen, like a mounted component's useQuery.
    const observer = new QueryObserver(queryClient, { queryKey: ["trading-day", "open"], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Hidden for longer than the replay window reaches back: no replay can
    // cover the whole time away, so this re-read is what does.
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(61_000);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(2);

    unsubscribe();
    queryClient.unmount();
  });

  it("a change during a slow read gets a read of its own once that one is done", async () => {
    const queryClient = new QueryClient();
    let reads = 0;
    // A read that takes a second — a phone on a weak signal.
    const queryFn = vi.fn(async () => {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return `answer ${reads}`;
    });
    const observer = new QueryObserver(queryClient, { queryKey: ["shop"], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    startLiveUpdates(queryClient);

    // Someone saves while the read is still on its way: its answer may
    // predate the save, so it can't stand in for a fresh read.
    await vi.advanceTimersByTimeAsync(200);
    broadcast(onlyChannel());
    await vi.advanceTimersByTimeAsync(800);
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Once it's back, the refresh goes out and asks again.
    await vi.advanceTimersByTimeAsync(300);
    expect(queryFn).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
