import { describe, expect, it } from "vitest";

import { toInputText } from "./number-field";

describe("toInputText", () => {
  it("shows nothing for a missing value", () => {
    expect(toInputText(null)).toBe("");
  });

  it("keeps zero as a real value, not an empty field", () => {
    expect(toInputText(0)).toBe("0");
  });

  it("prints whole and decimal numbers the way an input would", () => {
    expect(toInputText(8)).toBe("8");
    expect(toInputText(117.25)).toBe("117.25");
    // numeric(10,2) arrives as 120.5 for a stored 120.50 — the same text
    // React would have put in the field for the number itself.
    expect(toInputText(120.5)).toBe(String(120.5));
  });
});
