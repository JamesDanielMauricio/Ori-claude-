import { describe, expect, it } from "vitest";

import {
  buildBoard,
  findPickLine,
  growerCarries,
  hasSupply,
  listedFamilies,
  markSelected,
  type BoardCompany,
  type BoardPick,
  type BoardRecord,
  type BoardVarietyRow,
  type GrowerPickLine,
} from "./board-data";

// The fixture is the grower card in the bug report: Avrahami Ehud's lemon
// family, where only "לימון 100" holds anything (0 picked, 5 leftover carried
// in) and the other four are the blank 0 / 0 lines every in-season product
// gets when the day starts. A lychee family with one blank line sits beside it,
// to see a family left with nothing under it disappear.

const GROWER_A = "grower-a";
const GROWER_B = "grower-b";
const CUSTOMER_1 = "customer-1";

const companies: BoardCompany[] = [
  { id: GROWER_A, name: "אברהמי אהוד", default_pickup_time: null },
  { id: GROWER_B, name: "גולדי", default_pickup_time: null },
];

const lemonFamily = { name: "לימון", image_url: null };
const lycheeFamily = { name: "ליצ׳י", image_url: null };

const variety = (id: string, name: string, familyId: string, family: typeof lemonFamily) => ({
  id,
  name,
  family_id: familyId,
  product_families: family,
});
const trepak = variety("variety-trepak", "טרפק אברהמי", "family-lemon", lemonFamily);
const lemon100 = variety("variety-lemon-100", "לימון 100", "family-lemon", lemonFamily);
const lemon123 = variety("variety-lemon-123", "לימון 123", "family-lemon", lemonFamily);
const lemon72 = variety("variety-lemon-72", "לימון 72", "family-lemon", lemonFamily);
const lemon88 = variety("variety-lemon-88", "לימון 88", "family-lemon", lemonFamily);
const lychee = variety("variety-lychee", "ליצי ארוז", "family-lychee", lycheeFamily);

function pickLine(
  id: string,
  pickId: string,
  v: BoardVarietyRow,
  picked: string,
  leftover: string,
) {
  return {
    id,
    daily_pick_id: pickId,
    product_variety_id: v.id,
    pallets_picked: picked,
    leftover_pallets: leftover,
    comment: null,
    product_varieties: v,
  };
}

// Avrahami Ehud, exactly as in the report.
const pickA: BoardPick = {
  id: "pick-a",
  grower_company_id: GROWER_A,
  status: "draft",
  pickup_time: "07:00:00",
  daily_pick_products: [
    pickLine("line-a-trepak", "pick-a", trepak, "0", "0"),
    pickLine("line-a-lemon-100", "pick-a", lemon100, "0", "5"),
    pickLine("line-a-lemon-123", "pick-a", lemon123, "0", "0"),
    pickLine("line-a-lemon-72", "pick-a", lemon72, "0", "0"),
    pickLine("line-a-lemon-88", "pick-a", lemon88, "0", "0"),
    pickLine("line-a-lychee", "pick-a", lychee, "0", "0"),
  ],
};

// A second grower with a blank line for the same lemon — to tell growers apart
// by what they hold rather than by what they are assigned.
const pickB: BoardPick = {
  id: "pick-b",
  grower_company_id: GROWER_B,
  status: "draft",
  pickup_time: null,
  daily_pick_products: [pickLine("line-b-lemon-100", "pick-b", lemon100, "0", "0")],
};

const build = (picks: BoardPick[], records: BoardRecord[] = []) =>
  buildBoard({ picks, orders: [], records, companies });

const line = (over: Partial<GrowerPickLine> = {}): GrowerPickLine => ({
  pickLineId: "line",
  varietyId: "variety",
  varietyName: "זן",
  picked: 0,
  leftover: 0,
  allocated: 0,
  remaining: 0,
  comment: null,
  ...over,
});

describe("hasSupply", () => {
  it("is true for a line with pallets picked", () => {
    expect(hasSupply(line({ picked: 3 }))).toBe(true);
  });

  it("is true for a line with only leftover carried in — the report's לימון 100", () => {
    expect(hasSupply(line({ picked: 0, leftover: 5 }))).toBe(true);
  });

  it("is true for half a pallet", () => {
    expect(hasSupply(line({ picked: 0.5 }))).toBe(true);
  });

  it("is false for a blank line", () => {
    expect(hasSupply(line())).toBe(false);
  });

  it("is true for a line with pallets arranged against it, even at 0 picked and 0 leftover", () => {
    // A line served wholly from carried-in stock ends a closed day like this
    // (close_out_pick_leftovers), and the history view still has to show it.
    expect(hasSupply(line({ picked: 0, leftover: 0, allocated: 5 }))).toBe(true);
  });
});

describe("listedFamilies", () => {
  it("lists only לימון 100 on the report's card, and drops the family left with nothing", () => {
    const grower = build([pickA]).growers[0]!;
    // The data underneath is whole: six lines in two families.
    expect(grower.families.map((f) => f.lines.length)).toEqual([5, 1]);

    const listed = listedFamilies(grower.families);
    expect(listed.map((f) => f.familyName)).toEqual(["לימון"]);
    expect(listed[0]!.lines.map((l) => [l.varietyName, l.picked, l.leftover])).toEqual([
      ["לימון 100", 0, 5],
    ]);
  });

  it("keeps every line, and the same family object, when they all have supply", () => {
    const full: BoardPick = {
      ...pickA,
      daily_pick_products: [
        pickLine("l1", "pick-a", lemon100, "2", "0"),
        pickLine("l2", "pick-a", lemon123, "0", "1"),
      ],
    };
    const grower = build([full]).growers[0]!;
    const listed = listedFamilies(grower.families);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toBe(grower.families[0]);
    expect(listed[0]!.lines.map((l) => l.varietyName)).toEqual(["לימון 100", "לימון 123"]);
  });

  it("keeps the order the lines and families come in", () => {
    const grower = build([
      {
        ...pickA,
        daily_pick_products: [
          pickLine("l1", "pick-a", lemon88, "1", "0"),
          pickLine("l2", "pick-a", lemon72, "1", "0"),
          pickLine("l3", "pick-a", lychee, "1", "0"),
          pickLine("l4", "pick-a", lemon100, "0", "0"),
        ],
      },
    ]).growers[0]!;
    const listed = listedFamilies(grower.families);
    expect(listed.map((f) => f.familyName)).toEqual(grower.families.map((f) => f.familyName));
    expect(listed.flatMap((f) => f.lines.map((l) => l.varietyName))).toEqual(
      grower.families.flatMap((f) =>
        f.lines.filter((l) => l.picked + l.leftover > 0).map((l) => l.varietyName),
      ),
    );
  });

  it("lists nothing for a grower with no supply at all", () => {
    const blank: BoardPick = {
      ...pickA,
      daily_pick_products: pickA.daily_pick_products.map((l) =>
        pickLine(l.id, "pick-a", l.product_varieties!, "0", "0"),
      ),
    };
    expect(listedFamilies(build([blank]).growers[0]!.families)).toEqual([]);
  });

  it("still lists a line with pallets arranged against it after its supply has gone to 0", () => {
    const record: BoardRecord = {
      id: "record-1",
      daily_pick_product_id: "line-a-trepak",
      daily_order_product_id: "order-line-1",
      customer_company_id: CUSTOMER_1,
      quantity_pallets: 5,
      price: null,
      price_type: null,
    };
    const grower = build([pickA], [record]).growers[0]!;
    const names = listedFamilies(grower.families).flatMap((f) => f.lines.map((l) => l.varietyName));
    expect(names).toEqual(["טרפק אברהמי", "לימון 100"]);
  });

  it("does not modify what it is given", () => {
    const grower = build([pickA]).growers[0]!;
    const before = JSON.stringify(grower.families);
    listedFamilies(grower.families);
    expect(JSON.stringify(grower.families)).toBe(before);
  });
});

describe("growerCarries", () => {
  const [a, b] = build([pickA, pickB]).growers;
  const growerA = a!.growerId === GROWER_A ? a! : b!;
  const growerB = a!.growerId === GROWER_B ? a! : b!;

  it("is true for a variety the grower has supply of", () => {
    expect(growerCarries(growerA, lemon100.id)).toBe(true);
  });

  it("is false for a variety the grower only has a blank line for", () => {
    expect(growerCarries(growerA, lemon123.id)).toBe(false);
    expect(growerCarries(growerB, lemon100.id)).toBe(false);
  });

  it("is false for a variety the grower has no line for", () => {
    expect(growerCarries(growerB, lychee.id)).toBe(false);
  });
});

describe("markSelected", () => {
  it("marks only the growers that have supply of the selected variety", () => {
    const board = build([pickA, pickB]);
    const marked = markSelected(board, lemon100.id);
    const flag = (growerId: string) =>
      marked.growers.find((grower) => grower.growerId === growerId)?.hasSelected;
    expect(flag(GROWER_A)).toBe(true);
    // Grower B has a line for the same variety, but it is blank.
    expect(flag(GROWER_B)).toBe(false);
  });

  it("returns the board untouched when nothing is selected", () => {
    const board = build([pickA, pickB]);
    expect(markSelected(board, null)).toBe(board);
  });
});

describe("the board data underneath stays whole", () => {
  // Hiding a blank line from a card must not change what the screen computes
  // from it: the selection resolves against the full board, the totals add up
  // the same, and a grower with nothing yet is still on the roll-call.
  it("still resolves a selection on a blank line", () => {
    const board = build([pickA]);
    const found = findPickLine(board, "line-a-lemon-123");
    expect(found?.line.varietyName).toBe("לימון 123");
    expect(found?.grower.growerName).toBe("אברהמי אהוד");
  });

  it("keeps the grower's totals as they were", () => {
    const grower = build([pickA]).growers[0]!;
    expect(grower.picked).toBe(0);
    expect(grower.leftover).toBe(5);
    expect(grower.allocated).toBe(0);
  });

  it("keeps a grower whose lines are all blank in the list of growers", () => {
    const blank: BoardPick = {
      ...pickB,
      daily_pick_products: [pickLine("line-b", "pick-b", lemon100, "0", "0")],
    };
    const board = build([pickA, blank]);
    expect(board.growers.map((g) => g.growerId).sort()).toEqual([GROWER_A, GROWER_B].sort());
  });
});
