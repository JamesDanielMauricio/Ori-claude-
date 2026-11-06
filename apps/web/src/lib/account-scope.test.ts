import { describe, expect, it } from "vitest";

import { startsNewAccountScope } from "./account-scope";

describe("startsNewAccountScope", () => {
  it("keeps the cache when someone signs in on a signed-out screen (or the page loads)", () => {
    expect(startsNewAccountScope(null, "user-a")).toBe(false);
  });

  it("keeps the cache while the same account stays signed in (an hourly token refresh)", () => {
    expect(startsNewAccountScope("user-a", "user-a")).toBe(false);
  });

  it("starts over when the account signs out", () => {
    expect(startsNewAccountScope("user-a", null)).toBe(true);
  });

  it("starts over when another account replaces it without a sign-out in between", () => {
    expect(startsNewAccountScope("user-a", "user-b")).toBe(true);
  });

  it("has nothing to do while nobody is signed in", () => {
    expect(startsNewAccountScope(null, null)).toBe(false);
  });
});
