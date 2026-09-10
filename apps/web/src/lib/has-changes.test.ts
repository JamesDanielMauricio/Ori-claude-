import { describe, expect, it } from "vitest";

import { hasChanges } from "./has-changes";

describe("hasChanges", () => {
  it("reports no change for an identical form state", () => {
    const form = { name: "Ori", status: "active", whatsappGroupId: "" };
    expect(hasChanges(form, { ...form })).toBe(false);
  });

  it("reports a change for every field type a form here carries", () => {
    const base = { name: "Ori", active: true, cap: "5", version: null };
    expect(hasChanges({ ...base, name: "Ori 2" }, base)).toBe(true);
    expect(hasChanges({ ...base, active: false }, base)).toBe(true);
    expect(hasChanges({ ...base, cap: "6" }, base)).toBe(true);
    expect(hasChanges({ ...base, version: 2 }, base)).toBe(true);
  });

  it("ignores key order, so the field order of two literals cannot matter", () => {
    expect(hasChanges({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
  });

  it("treats undefined and null as the same absent value", () => {
    expect(hasChanges({ comment: undefined }, { comment: null })).toBe(false);
  });

  it("compares arrays as sets, so toggling a checkbox off and on is not a change", () => {
    expect(hasChanges(["b", "a"], ["a", "b"])).toBe(false);
    expect(hasChanges(["a"], ["a", "b"])).toBe(true);
    expect(hasChanges([], ["a"])).toBe(true);
  });

  it("compares a Set by its members, not as an opaque object", () => {
    // UsersPage keeps its product blacklist as a Set. Object.entries() on a
    // Set is empty, so without explicit handling every Set would look
    // identical and ticking a blacklist checkbox would leave "שמור" dead.
    const blocked = { blockedProductVarietyIds: new Set(["a", "b"]) };
    expect(hasChanges(blocked, { blockedProductVarietyIds: new Set(["b", "a"]) })).toBe(false);
    expect(hasChanges(blocked, { blockedProductVarietyIds: new Set(["a"]) })).toBe(true);
    expect(hasChanges(blocked, { blockedProductVarietyIds: new Set(["a", "b", "c"]) })).toBe(true);
    expect(hasChanges(blocked, { blockedProductVarietyIds: new Set() })).toBe(true);
  });

  it("sees through nesting, which is where a hand-written compare would stop", () => {
    const caps = { customerPalletCaps: [{ customerCompanyId: "c1", maxPallets: "3" }] };
    expect(hasChanges(caps, { customerPalletCaps: [{ customerCompanyId: "c1", maxPallets: "3" }] })).toBe(
      false,
    );
    expect(hasChanges(caps, { customerPalletCaps: [{ customerCompanyId: "c1", maxPallets: "4" }] })).toBe(
      true,
    );
    expect(hasChanges(caps, { customerPalletCaps: [] })).toBe(true);
  });

  it("distinguishes a string from the number that prints the same", () => {
    // The order/pick editors compare the values they would SEND (numbers),
    // not the strings in their inputs, precisely so this distinction never
    // reaches a user as a phantom change.
    expect(hasChanges({ pallets: "3" }, { pallets: 3 })).toBe(true);
  });
});
