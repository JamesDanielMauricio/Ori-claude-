import { describe, expect, it } from "vitest";

import type { BoardCompany, BoardOrder, BoardPick, BoardRecord } from "./board-data";
import {
  buildMatrix,
  cellTarget,
  cellTone,
  filterMatrixRows,
  flattenMatrixRows,
  orderedOnly,
  productColumnWidth,
  type MatrixProductRow,
  type ProposedAllocation,
} from "./matrix-data";

// The fixture is the reference screenshot's own first four rows, shrunk to
// two customers: a lemon picked by TWO growers (the expandable row, with an
// allocation already made off the second grower's lot) and a lychee picked by
// ONE (the row that is typed into directly).

const GROWER_A = "grower-a";
const GROWER_B = "grower-b";
const CUSTOMER_1 = "customer-1";
const CUSTOMER_2 = "customer-2";

const companies: BoardCompany[] = [
  { id: GROWER_A, name: "אברהמי אהוד", default_pickup_time: null },
  { id: GROWER_B, name: "גולדי", default_pickup_time: null },
  { id: CUSTOMER_1, name: "אבי הפצה", default_pickup_time: null },
  { id: CUSTOMER_2, name: "בני שיווק", default_pickup_time: null },
];

const lemon = {
  id: "variety-lemon",
  name: "לימון 100",
  family_id: "family-lemon",
  product_families: { name: "לימון", image_url: null },
};
const lychee = {
  id: "variety-lychee",
  name: "ליצי ארוז",
  family_id: "family-lychee",
  product_families: { name: "ליצ׳י", image_url: null },
};

function pickLine(
  id: string,
  pickId: string,
  variety: typeof lemon,
  pallets: string,
  leftover = "0",
) {
  return {
    id,
    daily_pick_id: pickId,
    product_variety_id: variety.id,
    pallets_picked: pallets,
    leftover_pallets: leftover,
    comment: null,
    product_varieties: variety,
  };
}

function orderLine(
  id: string,
  orderId: string,
  variety: typeof lemon,
  pallets: string,
  comment: string | null = null,
) {
  return {
    id,
    daily_order_id: orderId,
    product_variety_id: variety.id,
    pallets_ordered: pallets,
    comment,
    product_varieties: variety,
  };
}

const picks: BoardPick[] = [
  {
    id: "pick-a",
    grower_company_id: GROWER_A,
    status: "submitted",
    pickup_time: null,
    daily_pick_products: [
      pickLine("line-a-lemon", "pick-a", lemon, "5"),
      pickLine("line-a-lychee", "pick-a", lychee, "7"),
    ],
  },
  {
    id: "pick-b",
    grower_company_id: GROWER_B,
    status: "submitted",
    pickup_time: null,
    daily_pick_products: [pickLine("line-b-lemon", "pick-b", lemon, "10")],
  },
];

const orders: BoardOrder[] = [
  {
    id: "order-1",
    customer_company_id: CUSTOMER_1,
    status: "submitted",
    daily_order_products: [orderLine("ol-1-lychee", "order-1", lychee, "5")],
    order_submission_logs: [],
  },
  {
    id: "order-2",
    customer_company_id: CUSTOMER_2,
    status: "submitted",
    daily_order_products: [orderLine("ol-2-lemon", "order-2", lemon, "3")],
    order_submission_logs: [],
  },
];

// Two of grower B's ten lemon pallets are already committed to customer 2.
const records: BoardRecord[] = [
  {
    id: "record-1",
    daily_pick_product_id: "line-b-lemon",
    daily_order_product_id: "ol-2-lemon",
    customer_company_id: CUSTOMER_2,
    quantity_pallets: 2,
    price: 12.5,
    price_type: "fixed",
  },
];

function build() {
  return buildMatrix({ picks, orders, records, companies });
}

function rowFor(varietyId: string): MatrixProductRow {
  const row = build().rows.find((candidate) => candidate.varietyId === varietyId);
  if (!row) throw new Error(`no row for ${varietyId}`);
  return row;
}

describe("buildMatrix columns", () => {
  it("is one column per customer with an order header, sorted by name", () => {
    expect(build().columns.map((column) => column.customerName)).toEqual([
      "אבי הפצה",
      "בני שיווק",
    ]);
  });

  it("keeps a customer who ordered nothing at all", () => {
    const withSilentCustomer = buildMatrix({
      picks,
      orders: [
        ...orders,
        {
          id: "order-3",
          customer_company_id: GROWER_A, // reused id, only the column matters
          status: "submitted",
          daily_order_products: [],
          order_submission_logs: [],
        },
      ],
      records,
      companies,
    });
    // They are a column of zeroes rather than absent: arrange_to_customer
    // needs only the order header, so surplus can still be pushed to them.
    expect(withSilentCustomer.columns).toHaveLength(3);
  });
});

describe("buildMatrix product rows", () => {
  it("pools a variety's growers into one row and totals their stock", () => {
    const row = rowFor(lemon.id);
    expect(row.inStock).toBe(15);
    expect(row.allocated).toBe(2);
    expect(row.available).toBe(13);
    expect(row.ordered).toBe(3);
  });

  it("is expandable only when two or more growers picked the variety", () => {
    expect(rowFor(lemon.id).expandable).toBe(true);
    expect(rowFor(lemon.id).growers).toHaveLength(2);
    expect(rowFor(lychee.id).expandable).toBe(false);
    expect(rowFor(lychee.id).growers).toHaveLength(1);
  });

  it("sums its growers' allocations per customer, with no record of its own", () => {
    const row = rowFor(lemon.id);
    const cell = row.cells[1]!; // בני שיווק
    expect(cell.ordered).toBe(3);
    expect(cell.allocated).toBe(2);
    // The sum spans however many records the growers below hold, so there is
    // no single record for an edit here to address — which is what makes the
    // row read-only.
    expect(cell.recordId).toBeNull();
  });

  it("takes the sole grower's cells verbatim when only one lot exists", () => {
    const row = rowFor(lychee.id);
    expect(row.cells).toBe(row.growers[0]!.cells);
    expect(row.cells[0]!.ordered).toBe(5);
  });
});

describe("buildMatrix grower rows", () => {
  it("attributes each allocation to the lot it came off", () => {
    const [growerA, growerB] = rowFor(lemon.id).growers;
    expect(growerA!.growerName).toBe("אברהמי אהוד");
    expect(growerA!.cells[1]!.allocated).toBe(0);
    expect(growerA!.available).toBe(5);

    expect(growerB!.growerName).toBe("גולדי");
    expect(growerB!.cells[1]!.allocated).toBe(2);
    expect(growerB!.cells[1]!.recordId).toBe("record-1");
    expect(growerB!.available).toBe(8);
  });

  it("carries the parent's ordered figure so the demand tint runs down them", () => {
    // The number is never printed on a grower row, but the highlight is —
    // the request is against the variety, so every lot of it is a candidate.
    for (const grower of rowFor(lemon.id).growers) {
      expect(grower.cells[1]!.ordered).toBe(3);
    }
  });

  it("carries price and price type so a quantity edit cannot blank them", () => {
    const growerB = rowFor(lemon.id).growers[1]!;
    expect(growerB.cells[1]!.price).toBe(12.5);
    expect(growerB.cells[1]!.priceType).toBe("fixed");
  });

  it("folds leftover_pallets into available as real supply, without inflating inStock", () => {
    // Grower A's lemon line carries 4 leftover pallets carried forward from a
    // prior day (bootstrap_grower_pick / sync_grower_picks, migration 0050) —
    // real, immediately arrangeable supply on top of the fresh pick, but
    // tracked separately so inStock still reads as "picked today" alone.
    const withLeftover = buildMatrix({
      picks: [
        {
          ...picks[0]!,
          daily_pick_products: [
            pickLine("line-a-lemon", "pick-a", lemon, "5", "4"),
            picks[0]!.daily_pick_products[1]!,
          ],
        },
        picks[1]!,
      ],
      orders,
      records,
      companies,
    });
    const growerA = withLeftover.rows.find((row) => row.varietyId === lemon.id)!.growers[0]!;
    expect(growerA.inStock).toBe(5);
    expect(growerA.leftover).toBe(4);
    expect(growerA.available).toBe(9); // 5 picked + 4 leftover - 0 allocated

    const row = withLeftover.rows.find((r) => r.varietyId === lemon.id)!;
    expect(row.inStock).toBe(15); // unchanged: picked only, summed across growers
    expect(row.leftover).toBe(4);
    expect(row.available).toBe(17); // 15 picked + 4 leftover - 2 allocated
  });

  it("counts a record whose order line is missing against the lot's supply", () => {
    // The pallets left the grower either way. Dropping them from `available`
    // would show supply as free when it is not — the one figure here that
    // must never read high.
    const orphaned = buildMatrix({
      picks,
      orders,
      records: [
        ...records,
        {
          id: "record-2",
          daily_pick_product_id: "line-b-lemon",
          daily_order_product_id: "ol-vanished",
          customer_company_id: "customer-gone",
          quantity_pallets: 3,
          price: null,
          price_type: null,
        },
      ],
      companies,
    });
    const growerB = orphaned.rows.find((row) => row.varietyId === lemon.id)!.growers[1]!;
    expect(growerB.allocated).toBe(5);
    expect(growerB.available).toBe(5);
    // ...but it belongs to no column, so no cell claims it.
    expect(growerB.cells.reduce((sum, cell) => sum + cell.allocated, 0)).toBe(2);
  });
});

describe("buildMatrix order comments", () => {
  // The same day as the fixture above, with a note on each order line: one
  // on the lemon (the expandable row) and one on the lychee (the row typed
  // into directly). Columns sort customer 1 first, customer 2 second.
  function buildWithNotes(lemonNote: string | null, lycheeNote: string | null) {
    return buildMatrix({
      picks,
      records,
      companies,
      orders: [
        {
          id: "order-1",
          customer_company_id: CUSTOMER_1,
          status: "submitted",
          daily_order_products: [orderLine("ol-1-lychee", "order-1", lychee, "5", lycheeNote)],
          order_submission_logs: [],
        },
        {
          id: "order-2",
          customer_company_id: CUSTOMER_2,
          status: "submitted",
          daily_order_products: [orderLine("ol-2-lemon", "order-2", lemon, "3", lemonNote)],
          order_submission_logs: [],
        },
      ],
    });
  }

  function rowIn(matrix: ReturnType<typeof buildMatrix>, varietyId: string): MatrixProductRow {
    const row = matrix.rows.find((candidate) => candidate.varietyId === varietyId);
    if (!row) throw new Error(`no row for ${varietyId}`);
    return row;
  }

  it("puts a customer's note on their own cell of the product row", () => {
    const lemonRow = rowIn(buildWithNotes("רק יפה", null), lemon.id);
    expect(lemonRow.cells.map((cell) => cell.comment)).toEqual([null, "רק יפה"]);
  });

  it("carries the note down the product's grower rows, as it does the ordered figure", () => {
    const lemonRow = rowIn(buildWithNotes("רק יפה", null), lemon.id);
    expect(lemonRow.growers.map((grower) => grower.cells[1]?.comment)).toEqual([
      "רק יפה",
      "רק יפה",
    ]);
  });

  it("keeps the note on a single-grower product row", () => {
    const lycheeRow = rowIn(buildWithNotes(null, "2 משטחים"), lychee.id);
    expect(lycheeRow.cells.map((cell) => cell.comment)).toEqual(["2 משטחים", null]);
  });

  it("trims the note, and reads a blank one as no note at all", () => {
    expect(rowIn(buildWithNotes("  רק יפה \n", null), lemon.id).cells[1]?.comment).toBe("רק יפה");
    expect(rowIn(buildWithNotes("   ", null), lemon.id).cells[1]?.comment).toBeNull();
  });

  it("is null on every cell when nobody left a note", () => {
    const comments = build().rows.flatMap((row) => row.cells.map((cell) => cell.comment));
    expect(comments).toEqual([null, null, null, null]);
  });
});

describe("cellTarget", () => {
  const { columns } = build();

  it("refuses a multi-grower product row", () => {
    expect(cellTarget(rowFor(lemon.id), 1, columns)).toBeNull();
  });

  it("addresses the sole grower's lot from a single-grower product row", () => {
    const target = cellTarget(rowFor(lychee.id), 0, columns);
    expect(target).toMatchObject({
      pickLineId: "line-a-lychee",
      customerId: CUSTOMER_1,
      current: 0,
    });
  });

  it("addresses the grower's own lot from a grower row", () => {
    const growerB = rowFor(lemon.id).growers[1]!;
    expect(cellTarget(growerB, 1, columns)).toMatchObject({
      pickLineId: "line-b-lemon",
      customerId: CUSTOMER_2,
      recordId: "record-1",
      current: 2,
    });
  });

  it("refuses a column that does not exist", () => {
    expect(cellTarget(rowFor(lychee.id), 99, columns)).toBeNull();
  });
});

describe("flattenMatrixRows", () => {
  it("leaves collapsed products as a single row", () => {
    const { rows } = build();
    expect(flattenMatrixRows(rows, new Set()).map((row) => row.kind)).toEqual([
      "product",
      "product",
    ]);
  });

  it("follows an expanded product with its growers, in order", () => {
    const { rows } = build();
    const flat = flattenMatrixRows(rows, new Set([lemon.id]));
    expect(flat.map((row) => row.kind)).toEqual(["product", "grower", "grower", "product"]);
  });

  it("ignores an expanded id for a row that cannot expand", () => {
    const { rows } = build();
    expect(flattenMatrixRows(rows, new Set([lychee.id]))).toHaveLength(2);
  });
});

describe("filterMatrixRows", () => {
  const { rows } = build();

  it("returns everything for an empty or blank query", () => {
    expect(filterMatrixRows(rows, "")).toHaveLength(2);
    expect(filterMatrixRows(rows, "   ")).toHaveLength(2);
  });

  it("matches on the variety name", () => {
    expect(filterMatrixRows(rows, "לימון 100").map((row) => row.varietyId)).toEqual([lemon.id]);
  });

  it("matches on the family name too", () => {
    // "לימון" is both here, so search on a family whose name is not repeated
    // in its variety: the lychee variety is "ליצי ארוז", the family "ליצ׳י".
    expect(filterMatrixRows(rows, "ליצ׳י").map((row) => row.varietyId)).toEqual([lychee.id]);
  });
});

// A proposal is a set of allocations that has been suggested but not saved.
// The grid shows the day as it would stand once they are saved, and says
// which numbers are not in the database yet.
describe("buildMatrix with a proposal on preview", () => {
  // Three of grower A's lychee pallets suggested for customer 1.
  const lycheeProposal = [{ pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 }];

  function preview(proposal = lycheeProposal) {
    const matrix = buildMatrix({ picks, orders, records, companies, proposal });
    const row = (varietyId: string) => {
      const found = matrix.rows.find((candidate) => candidate.varietyId === varietyId);
      if (!found) throw new Error(`no row for ${varietyId}`);
      return found;
    };
    return { lemons: row(lemon.id), lychees: row(lychee.id) };
  }

  it("shows a suggested quantity in its cell and marks it as not saved", () => {
    expect(preview().lychees.cells[0]).toMatchObject({ allocated: 3, proposed: 3, recordId: null });
  });

  it("takes a suggestion off what is still available on the lot", () => {
    const { lychees } = preview();

    expect(lychees.allocated).toBe(3);
    expect(lychees.available).toBe(4);
  });

  it("leaves a saved allocation unmarked", () => {
    const growerB = preview().lemons.growers[1];

    expect(growerB?.cells[1]).toMatchObject({ allocated: 2, proposed: 0, recordId: "record-1" });
  });

  it("carries a suggestion on one grower's lot up into the product row's sum", () => {
    const { lemons } = preview([
      { pickLineId: "line-a-lemon", customerId: CUSTOMER_2, quantity: 1 },
    ]);

    // Grower B's two saved pallets plus the one suggested off grower A.
    expect(lemons.cells[1]).toMatchObject({ allocated: 3, proposed: 1 });
    expect(lemons.growers[0]?.cells[1]).toMatchObject({ allocated: 1, proposed: 1 });
    expect(lemons.available).toBe(12);
  });

  it("adds a suggestion on top of a saved allocation without losing its record", () => {
    const { lemons } = preview([
      { pickLineId: "line-b-lemon", customerId: CUSTOMER_2, quantity: 1 },
    ]);

    expect(lemons.growers[1]?.cells[1]).toMatchObject({
      allocated: 3,
      proposed: 1,
      recordId: "record-1",
      price: 12.5,
      priceType: "fixed",
    });
  });

  it("adds up two suggestions for the same cell", () => {
    const { lychees } = preview([
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 },
      { pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 2 },
    ]);

    expect(lychees.cells[0]).toMatchObject({ allocated: 5, proposed: 5 });
    expect(lychees.available).toBe(2);
  });

  it("marks nothing when no proposal is on preview", () => {
    const cells = build().rows.flatMap((row) => [
      ...row.cells,
      ...row.growers.flatMap((grower) => grower.cells),
    ]);

    expect(cells.every((cell) => cell.proposed === 0)).toBe(true);
  });
});

// What a customer cell's colour says: nothing, "asked for and not yet
// arranged", or "has pallets arranged".
describe("cellTone", () => {
  it("is nothing for a cell nobody ordered and nothing is arranged in", () => {
    expect(cellTone({ ordered: 0, allocated: 0 })).toBe("none");
  });

  it("is 'ordered' while the customer's order has nothing arranged against it", () => {
    expect(cellTone({ ordered: 3, allocated: 0 })).toBe("ordered");
  });

  it("is 'arranged' as soon as the cell holds any pallets, even fewer than were ordered", () => {
    expect(cellTone({ ordered: 3, allocated: 1 })).toBe("arranged");
    expect(cellTone({ ordered: 3, allocated: 3 })).toBe("arranged");
  });

  it("is 'arranged' for pallets pushed to a customer who never ordered the product", () => {
    expect(cellTone({ ordered: 0, allocated: 2 })).toBe("arranged");
  });

  it("reads the grid's own cells: an ordered one, an arranged one, and one on preview", () => {
    const matrix = buildMatrix({
      picks,
      orders,
      records,
      companies,
      proposal: [{ pickLineId: "line-a-lychee", customerId: CUSTOMER_1, quantity: 3 }],
    });
    const row = (varietyId: string) =>
      matrix.rows.find((candidate) => candidate.varietyId === varietyId);
    const lemons = row(lemon.id);
    const lychees = row(lychee.id);

    // Customer 2 ordered lemons and has two of grower B's arranged; grower A's
    // lot holds none of them, so on that lot the request still stands open.
    expect(lemons?.cells.map(cellTone)).toEqual(["none", "arranged"]);
    expect(lemons?.growers.map((grower) => cellTone(grower.cells[1]!))).toEqual([
      "ordered",
      "arranged",
    ]);
    // A suggestion on preview counts as a value in the cell.
    expect(lychees?.cells.map(cellTone)).toEqual(["arranged", "none"]);
    expect(
      build()
        .rows.find((candidate) => candidate.varietyId === lychee.id)
        ?.cells.map(cellTone),
    ).toEqual(["ordered", "none"]);
  });
});

// The products column is the one column whose width follows the grid's: wide
// where there is room for whole names, narrower where the room is better
// spent on showing another customer — but never so narrow that the names
// stop being readable.
describe("productColumnWidth", () => {
  it("takes about a seventh of the grid's width", () => {
    expect(productColumnWidth(1004)).toBe(141);
    expect(productColumnWidth(1250)).toBe(175);
  });

  it("stops shrinking at 120 pixels on a small window", () => {
    expect(productColumnWidth(800)).toBe(120);
    expect(productColumnWidth(500)).toBe(120);
  });

  it("stops growing at 200 pixels, however wide the screen", () => {
    expect(productColumnWidth(1500)).toBe(200);
    expect(productColumnWidth(3200)).toBe(200);
  });

  it("starts at its narrowest before the grid has been measured", () => {
    expect(productColumnWidth(0)).toBe(120);
  });
});

// "הצג רק מוזמנים": the grid cut down to the products someone ordered and the
// customers who ordered — plus whatever holds pallets without an order, which
// is never hidden.
describe("orderedOnly", () => {
  const GROWER_C = "grower-c";
  // Trading today, ordered nothing. Named so as to sort first and last among
  // the customers: dropping the first column moves every one that is kept.
  const CUSTOMER_0 = "customer-0";
  const CUSTOMER_3 = "customer-3";

  const avocado = {
    id: "variety-avocado",
    name: "אבוקדו האס",
    family_id: "family-avocado",
    product_families: { name: "אבוקדו", image_url: null },
  };
  const mango = {
    id: "variety-mango",
    name: "מנגו עומר",
    family_id: "family-mango",
    product_families: { name: "מנגו", image_url: null },
  };

  const dayCompanies: BoardCompany[] = [
    ...companies,
    { id: GROWER_C, name: "דרום פרי", default_pickup_time: null },
    { id: CUSTOMER_0, name: "אא סיטונאות", default_pickup_time: null },
    { id: CUSTOMER_3, name: "תנובת השדה", default_pickup_time: null },
  ];

  // The shared day, plus two products nobody ordered: the avocado, which
  // stays untouched in every case below, and the mango, which is what gets
  // given away without an order.
  const dayPicks: BoardPick[] = [
    ...picks,
    {
      id: "pick-c",
      grower_company_id: GROWER_C,
      status: "submitted",
      pickup_time: null,
      daily_pick_products: [
        pickLine("line-c-avocado", "pick-c", avocado, "6"),
        pickLine("line-c-mango", "pick-c", mango, "4"),
      ],
    },
  ];

  function header(id: string, customerId: string, lines: BoardOrder["daily_order_products"] = []) {
    return {
      id,
      customer_company_id: customerId,
      status: "open",
      daily_order_products: lines,
      order_submission_logs: [],
    };
  }

  // open_shop gives every active customer a header, ordered or not.
  const dayOrders: BoardOrder[] = [
    header("order-0", CUSTOMER_0),
    ...orders,
    header("order-3", CUSTOMER_3),
  ];

  // The same day once a mango pallet has been pushed to customer 3: the line
  // of zero pallets is what arrange_to_customer creates to hang the record on.
  const pushedOrders: BoardOrder[] = [
    header("order-0", CUSTOMER_0),
    ...orders,
    header("order-3", CUSTOMER_3, [orderLine("ol-3-mango", "order-3", mango, "0")]),
  ];
  const pushedRecord: BoardRecord = {
    id: "record-push",
    daily_pick_product_id: "line-c-mango",
    daily_order_product_id: "ol-3-mango",
    customer_company_id: CUSTOMER_3,
    quantity_pallets: 1,
    price: null,
    price_type: null,
  };

  function day({
    dayOrdersOverride = dayOrders,
    dayRecords = [],
    proposal = [],
  }: {
    dayOrdersOverride?: BoardOrder[];
    dayRecords?: BoardRecord[];
    proposal?: ProposedAllocation[];
  } = {}) {
    return buildMatrix({
      picks: dayPicks,
      orders: dayOrdersOverride,
      records: dayRecords,
      companies: dayCompanies,
      proposal,
    });
  }

  const varieties = (matrix: ReturnType<typeof day>) => matrix.rows.map((row) => row.varietyId);
  const customers = (matrix: ReturnType<typeof day>) =>
    matrix.columns.map((column) => column.customerId);

  it("starts from a day with products nobody ordered and customers who ordered nothing", () => {
    const whole = day();

    expect(varieties(whole)).toEqual([avocado.id, lemon.id, lychee.id, mango.id]);
    expect(customers(whole)).toEqual([CUSTOMER_0, CUSTOMER_1, CUSTOMER_2, CUSTOMER_3]);
  });

  it("keeps only the products someone ordered, and only the customers who ordered", () => {
    const cut = orderedOnly(day());

    expect(varieties(cut)).toEqual([lemon.id, lychee.id]);
    expect(customers(cut)).toEqual([CUSTOMER_1, CUSTOMER_2]);
  });

  it("does not take an order line of zero pallets for an order", () => {
    // The line a push leaves behind once its pallets have been taken back.
    const cut = orderedOnly(day({ dayOrdersOverride: pushedOrders }));

    expect(varieties(cut)).toEqual([lemon.id, lychee.id]);
    expect(customers(cut)).toEqual([CUSTOMER_1, CUSTOMER_2]);
  });

  it("never hides pallets: a product given without an order stays, and so does whoever got it", () => {
    const cut = orderedOnly(day({ dayOrdersOverride: pushedOrders, dayRecords: [pushedRecord] }));

    expect(varieties(cut)).toEqual([lemon.id, lychee.id, mango.id]);
    expect(customers(cut)).toEqual([CUSTOMER_1, CUSTOMER_2, CUSTOMER_3]);
  });

  it("counts a suggestion on preview as pallets held", () => {
    const cut = orderedOnly(
      day({ proposal: [{ pickLineId: "line-c-mango", customerId: CUSTOMER_3, quantity: 2 }] }),
    );

    expect(varieties(cut)).toEqual([lemon.id, lychee.id, mango.id]);
    expect(customers(cut)).toEqual([CUSTOMER_1, CUSTOMER_2, CUSTOMER_3]);
  });

  it("keeps a product whose pallets went to someone with no column of their own", () => {
    // Off the grower's stock all the same — see buildMatrix on a record whose
    // order line did not come back.
    const cut = orderedOnly(
      day({
        dayRecords: [
          {
            ...pushedRecord,
            daily_order_product_id: "ol-not-in-the-day",
            customer_company_id: "customer-not-in-the-day",
          },
        ],
      }),
    );

    expect(varieties(cut)).toEqual([lemon.id, lychee.id, mango.id]);
    expect(customers(cut)).toEqual([CUSTOMER_1, CUSTOMER_2]);
  });

  it("keeps every row's cells lined up with the customers that are left", () => {
    const cut = orderedOnly(day());
    const lychees = cut.rows[1];

    // Customer 1 was the second column and is now the first.
    expect(lychees?.cells.map((cell) => cell.ordered)).toEqual([5, 0]);
    expect(lychees?.growers[0]?.cells.map((cell) => cell.ordered)).toEqual([5, 0]);
  });

  it("keeps every grower's lot under a product that is kept, arranged from or not", () => {
    const lemons = orderedOnly(day({ dayRecords: records })).rows[0];

    // All of what is arranged came off grower B's lot; grower A's five pallets
    // are exactly what is still there to give.
    expect(lemons?.growers.map((grower) => grower.growerId)).toEqual([GROWER_A, GROWER_B]);
    expect(lemons?.growers.map((grower) => grower.cells.length)).toEqual([2, 2]);
    expect(lemons?.expandable).toBe(true);
  });

  it("leaves a kept cell pointing at the same lot, customer and record as before", () => {
    const cut = orderedOnly(day({ dayRecords: records }));
    const growerB = cut.rows[0]?.growers[1];

    expect(growerB && cellTarget(growerB, 1, cut.columns)).toMatchObject({
      pickLineId: "line-b-lemon",
      customerId: CUSTOMER_2,
      recordId: "record-1",
      current: 2,
    });
  });

  it("is empty when nothing was ordered and nothing is arranged", () => {
    const cut = orderedOnly(
      day({
        dayOrdersOverride: dayOrders.map((order) => ({ ...order, daily_order_products: [] })),
      }),
    );

    expect(cut).toEqual({ columns: [], rows: [] });
  });

  it("leaves the matrix it was given as it was", () => {
    const whole = day();
    orderedOnly(whole);

    expect(whole.rows).toHaveLength(4);
    expect(whole.columns).toHaveLength(4);
    expect(whole.rows[1]?.cells).toHaveLength(4);
    expect(whole.rows[1]?.growers[0]?.cells).toHaveLength(4);
  });
});
