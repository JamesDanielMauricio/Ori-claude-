import { describe, expect, it } from "vitest";

import type { PickProductLineRow } from "@/lib/queries/grower";

import { linesToSave, mergeServerLines, toDraftLines } from "./pick-draft";

// The situation behind these tests: one grower's pick, open in two places —
// the grower's own screen and the distributor's pencil ("בשם מגדל" or the
// arrangement board) — each changing a different line.

const row = (
  id: string,
  picked: number,
  leftover = 0,
  comment: string | null = null,
): PickProductLineRow => ({
  id,
  pallets_picked: picked,
  leftover_pallets: leftover,
  comment,
  product_varieties: {
    name: id,
    sizes: null,
    family_id: "family",
    product_families: { name: "בננה", image_url: null },
  },
});

describe("mergeServerLines", () => {
  const loaded = [row("A", 5), row("B", 3), row("C", 0)];

  it("keeps the line being edited and takes the other side's change to another line", () => {
    const draft = toDraftLines(loaded).map((l) => (l.id === "A" ? { ...l, pallets: "8" } : l));
    const fresh = [row("A", 5), row("B", 9, 1, "נבדק"), row("C", 0)];
    const merged = mergeServerLines(draft, fresh, new Set(["A"]));
    expect(merged.find((l) => l.id === "A")).toMatchObject({ pallets: "8" });
    expect(merged.find((l) => l.id === "B")).toEqual({
      id: "B",
      pallets: "9",
      leftover: "1",
      comment: "נבדק",
    });
  });

  it("drops a line that left the pick (its variety went out of season) instead of keeping a ghost", () => {
    const draft = toDraftLines(loaded).map((l) => (l.id === "C" ? { ...l, pallets: "2" } : l));
    const fresh = [row("A", 5), row("B", 3)];
    expect(mergeServerLines(draft, fresh, new Set(["C"])).map((l) => l.id)).toEqual(["A", "B"]);
  });

  it("with nothing edited, is simply the server's lines", () => {
    const fresh = [row("A", 1), row("B", 2), row("C", 3)];
    expect(mergeServerLines(toDraftLines(loaded), fresh, new Set())).toEqual(toDraftLines(fresh));
  });
});

describe("linesToSave", () => {
  it("sends only the lines this person changed, so a save never rewrites anyone else's", () => {
    const draft = toDraftLines([row("A", 8), row("B", 3), row("C", 0)]);
    expect(linesToSave(draft, new Set(["A"]))).toEqual([
      { dailyPickProductId: "A", palletsPicked: 8, leftoverPallets: 0, comment: null },
    ]);
  });

  it("sends nothing when nothing changed (a save that only sends the pick)", () => {
    expect(linesToSave(toDraftLines([row("A", 8)]), new Set())).toEqual([]);
  });
});
