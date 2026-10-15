import { describe, expect, it } from "vitest";

import {
  cellLabel,
  lotOfPickLine,
  refusedCells,
  saveRefusalMessage,
  resolveProposal,
  setProposalCell,
  type ProposalLine,
} from "./arrangement-proposal";
import type { BoardCompany, BoardOrder, BoardPick, BoardRecord } from "./board-data";
import { buildMatrix } from "./matrix-data";

// Same small day as matrix-data.test.ts: lemons picked by TWO growers, with
// two of grower B's pallets already saved to customer 2, and lychees picked
// by ONE. Plus a third customer who is trading today and has ordered nothing.

const GROWER_A = "grower-a";
const GROWER_B = "grower-b";
const CUSTOMER_1 = "customer-1";
const CUSTOMER_2 = "customer-2";
const CUSTOMER_3 = "customer-3";
const LEMON = "variety-lemon";
const LYCHEE = "variety-lychee";

const companies: BoardCompany[] = [
  { id: GROWER_A, name: "אברהמי אהוד", default_pickup_time: null },
  { id: GROWER_B, name: "גולדי", default_pickup_time: null },
  { id: CUSTOMER_1, name: "אבי הפצה", default_pickup_time: null },
  { id: CUSTOMER_2, name: "בני שיווק", default_pickup_time: null },
  { id: CUSTOMER_3, name: "גבאי", default_pickup_time: null },
];

function variety(id: string, name: string) {
  return { id, name, family_id: `family-of-${id}`, product_families: { name, image_url: null } };
}

function pickLine(id: string, pickId: string, varietyId: string, pallets: string) {
  return {
    id,
    daily_pick_id: pickId,
    product_variety_id: varietyId,
    pallets_picked: pallets,
    leftover_pallets: "0",
    comment: null,
    product_varieties: variety(varietyId, varietyId),
  };
}

function orderLine(id: string, orderId: string, varietyId: string, pallets: string) {
  return {
    id,
    daily_order_id: orderId,
    product_variety_id: varietyId,
    pallets_ordered: pallets,
    comment: null,
    product_varieties: variety(varietyId, varietyId),
  };
}

const picks: BoardPick[] = [
  {
    id: "pick-a",
    grower_company_id: GROWER_A,
    status: "submitted",
    pickup_time: null,
    daily_pick_products: [
      pickLine("line-a-lemon", "pick-a", LEMON, "5"),
      pickLine("line-a-lychee", "pick-a", LYCHEE, "7"),
    ],
  },
  {
    id: "pick-b",
    grower_company_id: GROWER_B,
    status: "submitted",
    pickup_time: null,
    daily_pick_products: [pickLine("line-b-lemon", "pick-b", LEMON, "10")],
  },
];

const orders: BoardOrder[] = [
  {
    id: "order-1",
    customer_company_id: CUSTOMER_1,
    status: "submitted",
    daily_order_products: [orderLine("ol-1-lychee", "order-1", LYCHEE, "5")],
    order_submission_logs: [],
  },
  {
    id: "order-2",
    customer_company_id: CUSTOMER_2,
    status: "submitted",
    daily_order_products: [orderLine("ol-2-lemon", "order-2", LEMON, "3")],
    order_submission_logs: [],
  },
  {
    id: "order-3",
    customer_company_id: CUSTOMER_3,
    status: "open",
    daily_order_products: [],
    order_submission_logs: [],
  },
];

const savedLemons: BoardRecord = {
  id: "record-1",
  daily_pick_product_id: "line-b-lemon",
  daily_order_product_id: "ol-2-lemon",
  customer_company_id: CUSTOMER_2,
  quantity_pallets: 2,
  price: 12.5,
  price_type: "fixed",
};

function line(
  growerId: string,
  varietyId: string,
  customerId: string,
  quantity: number,
): ProposalLine {
  return { growerId, varietyId, customerId, quantity };
}

function resolve(lines: ProposalLine[], records: BoardRecord[] = [savedLemons]) {
  return resolveProposal({ lines, picks, orders, records });
}

describe("resolveProposal", () => {
  it("places a line on that grower's lot of that product", () => {
    expect(resolve([line(GROWER_A, LYCHEE, CUSTOMER_1, 3)])).toEqual({
      allocations: [{ pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 }],
      alreadyArranged: 0,
      unplaceable: 0,
      noLongerOrdered: 0,
    });
  });

  it("tells two growers' lots of the same product apart", () => {
    const { allocations } = resolve([
      line(GROWER_A, LEMON, CUSTOMER_1, 1),
      line(GROWER_B, LEMON, CUSTOMER_1, 2),
    ]);

    expect(allocations).toEqual([
      { pickLineId: "line-a-lemon", customerId: CUSTOMER_1, quantity: 1 },
      { pickLineId: "line-b-lemon", customerId: CUSTOMER_1, quantity: 2 },
    ]);
  });

  it("places a product on a customer who never ordered it", () => {
    // Customer 2 is trading today but has no lychee line: a push.
    expect(resolve([line(GROWER_A, LYCHEE, CUSTOMER_2, 1)]).allocations).toEqual([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_2, quantity: 1 },
    ]);
  });

  it("suggests to a customer who is trading but has ordered nothing at all", () => {
    expect(resolve([line(GROWER_A, LYCHEE, CUSTOMER_3, 2)]).allocations).toEqual([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_3, quantity: 2 },
    ]);
  });

  it("leaves out a cell that already has an allocation saved in it", () => {
    expect(resolve([line(GROWER_B, LEMON, CUSTOMER_2, 5)])).toEqual({
      allocations: [],
      alreadyArranged: 1,
      unplaceable: 0,
      noLongerOrdered: 0,
    });
  });

  it("cannot place a line on a lot the day does not have", () => {
    // Grower B picked no lychees.
    expect(resolve([line(GROWER_B, LYCHEE, CUSTOMER_1, 1)])).toEqual({
      allocations: [],
      alreadyArranged: 0,
      unplaceable: 1,
      noLongerOrdered: 0,
    });
  });

  it("cannot place a line on a lot whose product did not come back with it", () => {
    // The grid has no row for such a lot (buildMatrix skips it), so a
    // suggestion landed on it would be saved without ever having been shown.
    const withoutProduct = picks.map((pick) => ({
      ...pick,
      daily_pick_products: pick.daily_pick_products.map((pickLine) =>
        pickLine.id === "line-a-lychee" ? { ...pickLine, product_varieties: null } : pickLine,
      ),
    }));

    expect(
      resolveProposal({
        lines: [line(GROWER_A, LYCHEE, CUSTOMER_1, 1)],
        picks: withoutProduct,
        orders,
        records: [],
      }),
    ).toEqual({ allocations: [], alreadyArranged: 0, unplaceable: 1, noLongerOrdered: 0 });
  });

  it("cannot place a line for a customer who is not trading on the day", () => {
    expect(resolve([line(GROWER_A, LYCHEE, "customer-not-trading", 1)])).toEqual({
      allocations: [],
      alreadyArranged: 0,
      unplaceable: 1,
      noLongerOrdered: 0,
    });
  });

  it("cannot place a quantity that is not a whole number of pallets above zero", () => {
    const result = resolve([
      line(GROWER_A, LYCHEE, CUSTOMER_1, 0),
      line(GROWER_A, LYCHEE, CUSTOMER_1, -2),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 1.5),
    ]);

    expect(result).toEqual({
      allocations: [],
      alreadyArranged: 0,
      unplaceable: 3,
      noLongerOrdered: 0,
    });
  });

  it("adds up lines that land in the same cell", () => {
    const { allocations } = resolve([
      line(GROWER_A, LYCHEE, CUSTOMER_1, 1),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 2),
    ]);

    expect(allocations).toEqual([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 },
    ]);
  });

  it("shows a saved allocation under its order line's customer, and takes its cell for both names", () => {
    // The record's own copy of the customer says 1; the order line it was
    // arranged against is customer 2's. The two never differ in real data —
    // which is why the rule for when they do has to be pinned in one place:
    // the grid shows it where the order line puts it, and the cell is taken
    // for both customers, as save_arrangement_proposal judges it — a preview
    // that offered it to customer 1 would be refused on every save.
    const miscopied = { ...savedLemons, customer_company_id: CUSTOMER_1 };

    const result = resolve(
      [line(GROWER_B, LEMON, CUSTOMER_1, 1), line(GROWER_B, LEMON, CUSTOMER_2, 1)],
      [miscopied],
    );
    const growerB = buildMatrix({ picks, orders, records: [miscopied], companies }).rows.find(
      (row) => row.varietyId === LEMON,
    )?.growers[1];

    expect(growerB?.cells.map((cell) => cell.allocated)).toEqual([0, 2, 0]);
    expect(result).toEqual({
      allocations: [],
      alreadyArranged: 2,
      unplaceable: 0,
      noLongerOrdered: 0,
    });
  });
});

// The day is read again once a proposal has been saved, and whenever anybody
// else changes it while the proposal is still on preview. The proposal is
// worked out afresh against each read, so what it holds is always what is
// still to be saved.
describe("a proposal while its cells are being saved", () => {
  const lines = [line(GROWER_A, LYCHEE, CUSTOMER_1, 3), line(GROWER_A, LYCHEE, CUSTOMER_2, 1)];

  // Customer 2 never ordered lychees, so saving their cell created a
  // zero-pallet order line for it. The day is read in one statement, so the
  // record and that new line arrive together.
  const ordersAfterSave = orders.map((order) =>
    order.id === "order-2"
      ? {
          ...order,
          daily_order_products: [
            ...order.daily_order_products,
            orderLine("ol-2-lychee", "order-2", LYCHEE, "0"),
          ],
        }
      : order,
  );
  const savedPush: BoardRecord = {
    id: "record-2",
    daily_pick_product_id: "line-a-lychee",
    daily_order_product_id: "ol-2-lychee",
    customer_company_id: CUSTOMER_2,
    quantity_pallets: 1,
    price: null,
    price_type: null,
  };
  const records = [savedLemons, savedPush];

  it("drops each cell from the proposal once its allocation is saved", () => {
    expect(resolveProposal({ lines, picks, orders: ordersAfterSave, records })).toEqual({
      allocations: [{ pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 }],
      alreadyArranged: 1,
      unplaceable: 0,
      noLongerOrdered: 0,
    });
  });

  it("never counts a saved cell twice on the grid", () => {
    const matrix = buildMatrix({
      picks,
      orders: ordersAfterSave,
      records,
      companies,
      proposal: resolveProposal({ lines, picks, orders: ordersAfterSave, records }).allocations,
    });
    const lychees = matrix.rows.find((row) => row.varietyId === LYCHEE);

    // 1 saved to customer 2 + 3 still suggested for customer 1, off 7 picked.
    expect(lychees?.allocated).toBe(4);
    expect(lychees?.available).toBe(3);
    expect(lychees?.cells.map((cell) => [cell.allocated, cell.proposed])).toEqual([
      [3, 3],
      [1, 0],
      [0, 0],
    ]);
  });

  it("still knows a saved cell whose order line did not come back with it", () => {
    // Not expected of a single read; here because buildMatrix allows for it,
    // and the two must not disagree about which cells are taken.
    const orphaned = { ...savedPush, daily_order_product_id: "an-order-line-not-in-this-read" };

    expect(resolve(lines, [savedLemons, orphaned]).allocations).toEqual([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 },
    ]);
  });
});

// A suggestion is worked out against the orders as they stood when it was
// offered; customers keep changing them while the distributor looks it over.
describe("a suggested line whose order has changed since", () => {
  const suggested = (
    growerId: string,
    varietyId: string,
    customerId: string,
    quantity: number,
  ) => ({
    ...line(growerId, varietyId, customerId, quantity),
    suggested: true,
  });
  const ordersWithLychee = (pallets: string | null) =>
    orders.map((order) =>
      order.id === "order-1"
        ? {
            ...order,
            daily_order_products:
              pallets === null ? [] : [orderLine("ol-1-lychee", "order-1", LYCHEE, pallets)],
          }
        : order,
    );

  it("is dropped once the customer has withdrawn that order", () => {
    const resolved = resolveProposal({
      lines: [suggested(GROWER_A, LYCHEE, CUSTOMER_1, 3)],
      picks,
      orders: ordersWithLychee(null),
      records: [savedLemons],
    });

    expect(resolved.allocations).toEqual([]);
    expect(resolved.noLongerOrdered).toBe(1);
  });

  it("is cut to what is still on order once the order has been reduced", () => {
    const resolved = resolveProposal({
      lines: [suggested(GROWER_A, LYCHEE, CUSTOMER_1, 3)],
      picks,
      orders: ordersWithLychee("2"),
      records: [savedLemons],
    });

    expect(resolved.allocations).toEqual([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 2 },
    ]);
    expect(resolved.noLongerOrdered).toBe(1);
  });

  it("counts what is already saved to the customer off another lot against the order", () => {
    // Customer 2 ordered 3 lemons and has 2 off grower B's lot already.
    const resolved = resolve([suggested(GROWER_A, LEMON, CUSTOMER_2, 3)]);

    expect(resolved.allocations).toEqual([
      { pickLineId: "line-a-lemon", customerId: CUSTOMER_2, quantity: 1 },
    ]);
  });

  it("is left as it is while the order still covers it", () => {
    const resolved = resolve([suggested(GROWER_A, LYCHEE, CUSTOMER_1, 3)]);

    expect(resolved.allocations).toEqual([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 },
    ]);
    expect(resolved.noLongerOrdered).toBe(0);
  });

  it("leaves a number the distributor typed alone: pushing stock to someone is theirs to decide", () => {
    const typed = setProposalCell(
      [],
      { growerId: GROWER_A, varietyId: LEMON, customerId: CUSTOMER_3 },
      2,
    );

    expect(resolve(typed).allocations).toEqual([
      { pickLineId: "line-a-lemon", customerId: CUSTOMER_3, quantity: 2 },
    ]);
  });
});

describe("a cell taken under either name its record carries", () => {
  it("is not suggested over for the customer the record's own copy names", () => {
    // The order line says customer 2; the record's copy says customer 3. The
    // save treats the cell as filled for both, so the preview must too.
    const disagreeing: BoardRecord = { ...savedLemons, customer_company_id: CUSTOMER_3 };
    const resolved = resolveProposal({
      lines: [line(GROWER_B, LEMON, CUSTOMER_3, 1)],
      picks,
      orders,
      records: [disagreeing],
    });

    expect(resolved.allocations).toEqual([]);
    expect(resolved.alreadyArranged).toBe(1);
  });
});

// A refused save (save_arrangement_proposal, migration 0068) names the cell
// it refused in the error's DETAIL — one cell, or every filled cell at once.
describe("refusedCells", () => {
  it("reads the one cell a refusal names", () => {
    const details = JSON.stringify({
      index: 1,
      dailyPickProductId: "line-a-lemon",
      customerCompanyId: CUSTOMER_2,
      quantityPallets: 4,
    });

    expect(refusedCells(details)).toEqual([{ pickLineId: "line-a-lemon", customerId: CUSTOMER_2 }]);
  });

  it("reads every cell a conflict lists", () => {
    const details = JSON.stringify({
      cells: [
        { index: 0, dailyPickProductId: "line-a-lemon", customerCompanyId: CUSTOMER_1 },
        { index: 3, dailyPickProductId: "line-b-lemon", customerCompanyId: CUSTOMER_3 },
      ],
    });

    expect(refusedCells(details)).toEqual([
      { pickLineId: "line-a-lemon", customerId: CUSTOMER_1 },
      { pickLineId: "line-b-lemon", customerId: CUSTOMER_3 },
    ]);
  });

  it.each([undefined, null, "", "not json", "[]", '{"indexes":[0]}', '{"cells":"x"}'])(
    "names no cell when the detail does not (%s)",
    (details) => {
      expect(refusedCells(details)).toEqual([]);
    },
  );
});

describe("cellLabel", () => {
  const names = new Map(companies.map((company) => [company.id, company.name]));

  it("names a cell by product, grower and customer", () => {
    expect(cellLabel({ pickLineId: "line-b-lemon", customerId: CUSTOMER_2 }, picks, names)).toBe(
      `${LEMON} (גולדי) ← בני שיווק`,
    );
  });

  it("still says something for a lot or a customer it cannot name", () => {
    expect(cellLabel({ pickLineId: "line-gone", customerId: "customer-gone" }, picks, names)).toBe(
      "שורה שאינה ביום זה ← customer-gone",
    );
  });
});

// A proposal can be corrected before it is saved. A number typed into the grid
// arrives addressed the way every cell write is — a pick line and a customer —
// while the proposal is held as lines, so the first step is naming the lot.
describe("lotOfPickLine", () => {
  it("names the grower and the product a pick line belongs to", () => {
    expect(lotOfPickLine(picks, "line-b-lemon")).toEqual({ growerId: GROWER_B, varietyId: LEMON });
    expect(lotOfPickLine(picks, "line-a-lychee")).toEqual({
      growerId: GROWER_A,
      varietyId: LYCHEE,
    });
  });

  it("knows nothing of a pick line the day does not have", () => {
    expect(lotOfPickLine(picks, "line-from-another-day")).toBeNull();
  });

  it("knows nothing of a lot whose product did not come back with it", () => {
    // No row on the grid, and nowhere for resolveProposal to land a line.
    const orphaned = picks.map((pick) => ({
      ...pick,
      daily_pick_products: pick.daily_pick_products.map((pickLine) =>
        pickLine.id === "line-a-lychee" ? { ...pickLine, product_varieties: null } : pickLine,
      ),
    }));

    expect(lotOfPickLine(orphaned, "line-a-lychee")).toBeNull();
    expect(lotOfPickLine(orphaned, "line-a-lemon")).toEqual({
      growerId: GROWER_A,
      varietyId: LEMON,
    });
  });
});

describe("setProposalCell", () => {
  const lychees1 = { growerId: GROWER_A, varietyId: LYCHEE, customerId: CUSTOMER_1 };
  const offered = [
    line(GROWER_A, LEMON, CUSTOMER_1, 1),
    line(GROWER_A, LYCHEE, CUSTOMER_1, 3),
    line(GROWER_B, LEMON, CUSTOMER_3, 2),
  ];

  it("changes the quantity of a cell the proposal already holds, where it stands", () => {
    expect(setProposalCell(offered, lychees1, 5)).toEqual([
      line(GROWER_A, LEMON, CUSTOMER_1, 1),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 5),
      line(GROWER_B, LEMON, CUSTOMER_3, 2),
    ]);
  });

  it("adds a cell the proposal had nothing in, after the ones it holds", () => {
    const added = { growerId: GROWER_A, varietyId: LYCHEE, customerId: CUSTOMER_3 };

    expect(setProposalCell(offered, added, 2)).toEqual([
      ...offered,
      line(GROWER_A, LYCHEE, CUSTOMER_3, 2),
    ]);
  });

  it("takes a cell out of the proposal when it is emptied", () => {
    expect(setProposalCell(offered, lychees1, 0)).toEqual([
      line(GROWER_A, LEMON, CUSTOMER_1, 1),
      line(GROWER_B, LEMON, CUSTOMER_3, 2),
    ]);
  });

  it("leaves one line where several stood for the same cell: the number typed, not a sum", () => {
    const doubled = [
      line(GROWER_A, LYCHEE, CUSTOMER_1, 3),
      line(GROWER_B, LEMON, CUSTOMER_3, 2),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 1),
    ];

    expect(setProposalCell(doubled, lychees1, 2)).toEqual([
      line(GROWER_A, LYCHEE, CUSTOMER_1, 2),
      line(GROWER_B, LEMON, CUSTOMER_3, 2),
    ]);
    expect(setProposalCell(doubled, lychees1, 0)).toEqual([line(GROWER_B, LEMON, CUSTOMER_3, 2)]);
  });

  it("touches that grower's lot for that customer and nothing next to it", () => {
    const neighbours = [
      line(GROWER_A, LEMON, CUSTOMER_1, 1),
      line(GROWER_B, LEMON, CUSTOMER_1, 1),
      line(GROWER_A, LEMON, CUSTOMER_2, 1),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 1),
    ];

    expect(
      setProposalCell(
        neighbours,
        { growerId: GROWER_A, varietyId: LEMON, customerId: CUSTOMER_1 },
        4,
      ),
    ).toEqual([
      line(GROWER_A, LEMON, CUSTOMER_1, 4),
      line(GROWER_B, LEMON, CUSTOMER_1, 1),
      line(GROWER_A, LEMON, CUSTOMER_2, 1),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 1),
    ]);
  });

  it("leaves the proposal alone when the quantity is not a whole number of pallets", () => {
    for (const quantity of [2.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(setProposalCell(offered, lychees1, quantity)).toEqual(offered);
    }
  });

  it("does not change the lines it was given", () => {
    // Its own lines, not the ones the cases above share: a version that did
    // change them in place would already have emptied those of this cell.
    const given = [
      line(GROWER_A, LEMON, CUSTOMER_1, 1),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 3),
      line(GROWER_A, LYCHEE, CUSTOMER_1, 1),
    ];
    const before = structuredClone(given);
    setProposalCell(given, lychees1, 5);
    setProposalCell(given, lychees1, 0);

    expect(given).toEqual(before);
  });
});

// The same sequence the screen runs: a suggestion is offered, the distributor
// types over it, and the day is re-read — by this device after a save, or
// because someone else changed it.
describe("a proposal while it is being corrected", () => {
  const offered = [line(GROWER_B, LEMON, CUSTOMER_1, 1), line(GROWER_A, LYCHEE, CUSTOMER_1, 3)];

  /** A number typed into the cell at (pick line, customer), as the screen applies it. */
  function typed(lines: ProposalLine[], pickLineId: string, customerId: string, quantity: number) {
    const lot = lotOfPickLine(picks, pickLineId);
    if (!lot) throw new Error(`no lot for ${pickLineId}`);
    return setProposalCell(lines, { ...lot, customerId }, quantity);
  }

  it("saves the number that was typed, in the cell it was typed into", () => {
    const corrected = typed(offered, "line-b-lemon", CUSTOMER_1, 4);

    expect(resolve(corrected).allocations).toEqual([
      { pickLineId: "line-b-lemon", customerId: CUSTOMER_1, quantity: 4 },
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 },
    ]);
  });

  it("shows the typed number on the grid and counts it against that lot", () => {
    const corrected = typed(offered, "line-b-lemon", CUSTOMER_1, 4);
    const matrix = buildMatrix({
      picks,
      orders,
      records: [savedLemons],
      companies,
      proposal: resolve(corrected).allocations,
    });
    const growerB = matrix.rows
      .find((row) => row.varietyId === LEMON)
      ?.growers.find((grower) => grower.growerId === GROWER_B);
    const customer1 = matrix.columns.findIndex((column) => column.customerId === CUSTOMER_1);

    expect(growerB?.cells[customer1]).toMatchObject({ allocated: 4, proposed: 4 });
    // Two saved to customer 2 already, four more on preview, out of ten.
    expect(growerB).toMatchObject({ allocated: 6, available: 4 });
  });

  it("does not save a cell that was emptied", () => {
    const corrected = typed(offered, "line-b-lemon", CUSTOMER_1, 0);

    expect(resolve(corrected).allocations).toEqual([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 },
    ]);
  });

  it("saves a number typed into a cell the suggestion left empty", () => {
    const corrected = typed(offered, "line-a-lemon", CUSTOMER_3, 2);

    expect(resolve(corrected).allocations).toEqual([
      { pickLineId: "line-b-lemon", customerId: CUSTOMER_1, quantity: 1 },
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 },
      { pickLineId: "line-a-lemon", customerId: CUSTOMER_3, quantity: 2 },
    ]);
  });

  it("has nothing left to save once every cell has been emptied", () => {
    const emptied = typed(
      typed(offered, "line-b-lemon", CUSTOMER_1, 0),
      "line-a-lychee",
      CUSTOMER_1,
      0,
    );

    expect(emptied).toEqual([]);
    expect(resolve(emptied).allocations).toEqual([]);
  });

  it("lets go of a corrected cell once somebody else's allocation is saved in it", () => {
    const corrected = typed(offered, "line-a-lychee", CUSTOMER_1, 5);
    const theirs: BoardRecord = {
      id: "record-theirs",
      daily_pick_product_id: "line-a-lychee",
      daily_order_product_id: "ol-1-lychee",
      customer_company_id: CUSTOMER_1,
      quantity_pallets: 2,
      price: null,
      price_type: null,
    };

    const afterRead = resolve(corrected, [savedLemons, theirs]);

    expect(afterRead.allocations).toEqual([
      { pickLineId: "line-b-lemon", customerId: CUSTOMER_1, quantity: 1 },
    ]);
    expect(afterRead.alreadyArranged).toBe(1);
  });
});

// What the banner says when a save is refused — the one place a refusal is
// put into words, so the wording can be checked without a database.
describe("saveRefusalMessage", () => {
  const names = new Map(companies.map((company) => [company.id, company.name]));
  const cell = (pickLineId: string, customerCompanyId: string, index = 0) => ({
    index,
    dailyPickProductId: pickLineId,
    customerCompanyId,
  });

  it("says that cells filled meanwhile have left the proposal, names them, and that it can be saved again", () => {
    const message = saveRefusalMessage({
      error: {
        code: "P0006",
        details: JSON.stringify({
          cells: [cell("line-b-lemon", CUSTOMER_2), cell("line-a-lychee", CUSTOMER_1, 4)],
        }),
      },
      picks,
      names,
      reason: "ignored for a conflict",
    });

    expect(message).toBe(
      `לא נשמר דבר: תאים אלה שובצו בינתיים, והם ירדו מההצעה — ${LEMON} (גולדי) ← בני שיווק, ${LYCHEE} (אברהמי אהוד) ← אבי הפצה. אפשר לשמור שוב.`,
    );
  });

  it("names the one cell any other refusal was about, with the reason", () => {
    const message = saveRefusalMessage({
      error: { code: "P0009", details: JSON.stringify(cell("line-a-lychee", CUSTOMER_1)) },
      picks,
      names,
      reason: "הכמות חורגת.",
    });

    expect(message).toBe(`לא נשמר דבר. ${LYCHEE} (אברהמי אהוד) ← אבי הפצה: הכמות חורגת.`);
  });

  it("gives just the reason when the refusal names no cell", () => {
    expect(
      saveRefusalMessage({ error: { code: "42501" }, picks, names, reason: "אין הרשאה." }),
    ).toBe("לא נשמר דבר. אין הרשאה.");
  });
});
