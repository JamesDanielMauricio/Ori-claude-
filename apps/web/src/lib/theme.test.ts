import { describe, expect, it } from "vitest";

import { parseThemePreference, resolveTheme } from "./theme";

describe("parseThemePreference", () => {
  it("keeps each of the three known choices", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to system for a missing or unrecognised value", () => {
    for (const value of [null, undefined, "", "Dark", "sepia"]) {
      expect(parseThemePreference(value)).toBe("system");
    }
  });
});

describe("resolveTheme", () => {
  it("honours an explicit choice whatever the OS says", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS when the choice is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
