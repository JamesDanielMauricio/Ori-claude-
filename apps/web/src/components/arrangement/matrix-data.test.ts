import { describe, expect, it } from "vitest";

import type { BoardCompany, BoardOrder, BoardPick, BoardRecord } from "./board-data";
import {
  buildMatrix,
  cellTarget,
  filterMatrixRows,
  flattenMatrixRows,
  type MatrixProductRow,
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

function pickLine(id: string, pickId: string, variety: typeof lemon, pallets: string) {
  return {
    id,
    daily_pick_id: pickId,
    product_variety_id: variety.id,
    pallets_picked: pallets,
    comment: null,
    product_varieties: variety,
  };
}

function orderLine(id: string, orderId: string, variety: typeof lemon, pallets: string) {
  return {
    id,
    daily_order_id: orderId,
    product_variety_id: variety.id,
    pallets_ordered: pallets,
    comment: null,
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
