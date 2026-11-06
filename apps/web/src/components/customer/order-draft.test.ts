import { describe, expect, it } from "vitest";

import type { CatalogRow } from "./catalog-grouping";
import { mergeServerRows, toDraft, toSubmittedLines } from "./order-draft";

// The situation behind these tests: a customer has their order screen open
// and has started changing one line, while the distributor — ordering on
// their behalf from "בשם לקוח" or the arrangement board — changes or adds
// OTHER lines of the same order. The screen hears about it through the live
// updates (a fresh catalog), and whatever the customer then sends replaces
// the whole order (submit_order drops lines it is not sent).

const row = (varietyId: string, pallets: number, comment: string | null = null): CatalogRow => ({
  family_id: "family",
  family_name: "בננה",
  variety_id: varietyId,
  variety_name: varietyId,
  sizes: null,
  pack_type: "pallets",
  price: null,
  price_range_from: null,
  price_range_to: null,
  price_type: null,
  is_orderable: true,
  pallets_ordered: pallets,
  comment,
  image_url: null,
  max_orderable_for_customer: 20,
});

describe("mergeServerRows", () => {
  const loaded = [row("X", 2), row("Y", 0), row("Z", 5)];

  it("keeps the line the customer is editing, and takes the distributor's line added meanwhile", () => {
    const draft = { ...toDraft(loaded), X: { pallets: "3", comment: "" } };
    const fresh = [row("X", 2), row("Y", 4), row("Z", 5)];
    const merged = mergeServerRows(draft, fresh, new Set(["X"]));
    expect(toSubmittedLines(fresh, merged)).toEqual([
      { productVarietyId: "X", palletsOrdered: 3, comment: null },
      { productVarietyId: "Y", palletsOrdered: 4, comment: null },
      { productVarietyId: "Z", palletsOrdered: 5, comment: null },
    ]);
  });

  it("takes a change the distributor made to a line the customer has not touched", () => {
    const draft = { ...toDraft(loaded), X: { pallets: "3", comment: "" } };
    const fresh = [row("X", 2), row("Y", 0), row("Z", 1, "דחוף")];
    const merged = mergeServerRows(draft, fresh, new Set(["X"]));
    expect(merged.Z).toEqual({ pallets: "1", comment: "דחוף" });
  });

  it("takes a product that newly appeared in the shop", () => {
    const draft = { ...toDraft(loaded), X: { pallets: "3", comment: "" } };
    const fresh = [...loaded, row("W", 6)];
    expect(mergeServerRows(draft, fresh, new Set(["X"])).W).toEqual({ pallets: "6", comment: "" });
  });

  it("keeps the customer's own edit even when the same line changed on the server", () => {
    const draft = { ...toDraft(loaded), X: { pallets: "3", comment: "" } };
    const fresh = [row("X", 7), row("Y", 0), row("Z", 5)];
    expect(mergeServerRows(draft, fresh, new Set(["X"])).X).toEqual({ pallets: "3", comment: "" });
  });

  it("with nothing edited, is simply the server's order", () => {
    const fresh = [row("X", 1), row("Y", 4), row("Z", 0)];
    expect(mergeServerRows(toDraft(loaded), fresh, new Set())).toEqual(toDraft(fresh));
  });
});
