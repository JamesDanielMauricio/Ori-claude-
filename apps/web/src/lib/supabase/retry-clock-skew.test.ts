import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLOCK_SKEW_CODE, retryOnClockSkew } from "./retry-clock-skew";

type Result = { data: string | null; error: { code: string } | null };

const ok: Result = { data: "profile", error: null };
const skew: Result = { data: null, error: { code: CLOCK_SKEW_CODE } };

// A stand-in for a Supabase query factory: hands back the given results in
// order, one per call, and counts the calls.
function queries(...results: Result[]) {
  const run = vi.fn(() => Promise.resolve(results.shift() ?? ok));
  return run;
}

describe("retryOnClockSkew", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns a success straight away, without waiting", async () => {
    const run = queries(ok);
    await expect(retryOnClockSkew(run)).resolves.toEqual(ok);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits a second and asks again after a clock-skew refusal", async () => {
    const run = queries(skew, ok);
    const pending = retryOnClockSkew(run);

    // Not yet: the second attempt only goes out once the wait is over.
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual(ok);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts and returns the refusal to the caller", async () => {
    const run = queries(skew, skew, skew, ok);
    const pending = retryOnClockSkew(run);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual(skew);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("never retries any other error — the caller's own handling sees it at once", async () => {
    for (const code of ["PGRST116", "PGRST301", "42501", "500"]) {
      const other: Result = { data: null, error: { code } };
      const run = queries(other, ok);
      await expect(retryOnClockSkew(run)).resolves.toEqual(other);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
});
