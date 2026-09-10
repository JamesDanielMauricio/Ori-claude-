import { describe, expect, it } from "vitest";

import { parseIsoDate, todayIsoDate } from "./dates";

describe("todayIsoDate", () => {
  it("formats a date as YYYY-MM-DD with zero padding", () => {
    expect(todayIsoDate(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
    expect(todayIsoDate(new Date(2026, 11, 31, 12, 0, 0))).toBe("2026-12-31");
  });

  // The regression this helper exists for. Constructed from local components,
  // so it is 00:30 local on the 9th wherever the test runs. Any timezone ahead
  // of UTC turns that into the 8th under toISOString(); reading the local
  // components keeps it the 9th, which is the day the person clicking the
  // button is living in.
  it("returns the local calendar day just after midnight, not the UTC one", () => {
    const justAfterLocalMidnight = new Date(2026, 8, 9, 0, 30, 0);
    expect(todayIsoDate(justAfterLocalMidnight)).toBe("2026-09-09");
  });

  // The mirror case, for timezones behind UTC: late evening local is already
  // tomorrow in UTC.
  it("returns the local calendar day late at night, not the UTC one", () => {
    const lateLocalEvening = new Date(2026, 8, 9, 23, 30, 0);
    expect(todayIsoDate(lateLocalEvening)).toBe("2026-09-09");
  });
});

describe("parseIsoDate", () => {
  it("round-trips through todayIsoDate for an ordinary date", () => {
    expect(todayIsoDate(parseIsoDate("2026-09-09"))).toBe("2026-09-09");
  });

  it("builds a local-midnight Date, not a UTC one", () => {
    // new Date("2026-09-09") (UTC midnight) reads back as 2026-09-08 in any
    // timezone behind UTC — the exact regression todayIsoDate's own tests
    // guard on the write side. parseIsoDate must not reintroduce it on read.
    const parsed = parseIsoDate("2026-09-09");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(8);
    expect(parsed.getDate()).toBe(9);
    expect(parsed.getHours()).toBe(0);
  });
});
