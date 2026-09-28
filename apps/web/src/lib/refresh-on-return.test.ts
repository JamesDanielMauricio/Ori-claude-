import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { watchForReturns } from "./refresh-on-return";

// Stand-ins for the browser's document and window: real EventTargets, so the
// module's listeners fire exactly as they would on the real events.
let doc: EventTarget & { visibilityState: "visible" | "hidden" };
let win: EventTarget;

function setVisibility(state: "visible" | "hidden") {
  doc.visibilityState = state;
  doc.dispatchEvent(new Event("visibilitychange"));
}

describe("refresh on return", () => {
  let queryClient: QueryClient;
  let invalidate: MockInstance<QueryClient["invalidateQueries"]>;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
    win = new EventTarget();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", win);
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    stop = watchForReturns(queryClient);
  });
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does nothing on its own — there is no timer", async () => {
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("re-reads everything on screen when the tab is shown again", async () => {
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    setVisibility("visible");
    expect(invalidate).toHaveBeenCalledTimes(1);
    // Every query, and without restarting reads already in flight.
    expect(invalidate).toHaveBeenCalledWith(undefined, { cancelRefetch: false });
  });

  it("re-reads when the window gets focus back, or the device comes back online", async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    win.dispatchEvent(new Event("focus"));
    expect(invalidate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    win.dispatchEvent(new Event("online"));
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("treats the several signals of one return as one refresh", async () => {
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(120_000);
    // Switching back to a tab: shown, focused, and clicked — all at once.
    setVisibility("visible");
    win.dispatchEvent(new Event("focus"));
    win.dispatchEvent(new Event("pointerdown"));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-read right after the page loaded", () => {
    win.dispatchEvent(new Event("focus"));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("re-reads on the first touch after a minute away, not while someone is working", async () => {
    // Five minutes of steady work: a tap every ten seconds.
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      win.dispatchEvent(new Event("pointerdown"));
    }
    expect(invalidate).not.toHaveBeenCalled();

    // Looked away for a minute, then pressed a key.
    await vi.advanceTimersByTimeAsync(60_000);
    win.dispatchEvent(new Event("keydown"));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("downloads nothing in a hidden tab", async () => {
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    win.dispatchEvent(new Event("online"));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("holds off while this device is saving", async () => {
    vi.spyOn(queryClient, "isMutating").mockReturnValue(1);
    await vi.advanceTimersByTimeAsync(10_000);
    win.dispatchEvent(new Event("focus"));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stops listening when stopped", async () => {
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    win.dispatchEvent(new Event("focus"));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

// The point of refreshing "on return" is that it ignores the app's 30-second
// staleTime (lib/providers.tsx): data read 10 seconds ago is still re-read,
// because a day may have opened in those 10 seconds. Checked against the real
// React Query, no spies.
describe("refresh on return, against real queries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("re-reads a query that is still inside its staleTime", async () => {
    vi.useFakeTimers();
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", new EventTarget());
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    const queryFn = vi.fn(async () => null);
    const observer = new QueryObserver(queryClient, { queryKey: ["trading-day", "open"], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    const stop = watchForReturns(queryClient);
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(10_000);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(2);

    stop();
    unsubscribe();
  });
});
