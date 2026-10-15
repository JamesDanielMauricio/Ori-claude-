import { describe, expect, it } from "vitest";

import {
  customerFactsFrom,
  dayToPropose,
  historyFromRows,
  readAllPages,
  type HistoryRows,
} from "./arrangement-engine-input";
import type { BoardOrder, BoardPick, BoardRecord } from "./board-data";

const LEMON = "variety-lemon";
const LIME = "variety-lime";
const CITRUS = "family-citrus";
const CITRUS_ROW = { family_id: CITRUS };

function variety(id: string) {
  return { id, name: id, family_id: CITRUS, product_families: { name: "הדרים", image_url: null } };
}

describe("historyFromRows", () => {
  // Two days: 2.10 has been closed, 3.10 is still open.
  const rows: HistoryRows = {
    days: [
      { id: "day-3", trade_date: "2026-10-03", daily_arrangements: { status: "open" } },
      { id: "day-2", trade_date: "2026-10-02", daily_arrangements: { status: "closed" } },
      { id: "day-1", trade_date: "2026-10-01", daily_arrangements: null },
    ],
    pickLines: [
      // Closed day: leftover_pallets is what was LEFT when it closed (0050).
      {
        product_variety_id: LEMON,
        pallets_picked: "4",
        leftover_pallets: "1",
        daily_picks: { trading_day_id: "day-2" },
        product_varieties: CITRUS_ROW,
      },
      {
        product_variety_id: LEMON,
        pallets_picked: "2",
        leftover_pallets: "0",
        daily_picks: { trading_day_id: "day-2" },
        product_varieties: CITRUS_ROW,
      },
      // Open day: leftover_pallets is what was CARRIED IN from the day before.
      {
        product_variety_id: LIME,
        pallets_picked: "3",
        leftover_pallets: "2",
        daily_picks: { trading_day_id: "day-3" },
        product_varieties: CITRUS_ROW,
      },
    ],
    orderLines: [
      {
        product_variety_id: LEMON,
        pallets_ordered: "9",
        daily_orders: { trading_day_id: "day-2", customer_company_id: "gabbai" },
        product_varieties: CITRUS_ROW,
      },
      {
        product_variety_id: LIME,
        pallets_ordered: "0",
        daily_orders: { trading_day_id: "day-2", customer_company_id: "gabbai" },
        product_varieties: CITRUS_ROW,
      },
    ],
    records: [
      {
        quantity_pallets: "4",
        customer_company_id: "stale-copy",
        daily_arrangements: { trading_day_id: "day-2" },
        daily_pick_products: { product_variety_id: LEMON, product_varieties: CITRUS_ROW },
        daily_order_products: { daily_orders: { customer_company_id: "gabbai" } },
      },
      {
        quantity_pallets: "1",
        customer_company_id: "atara",
        daily_arrangements: { trading_day_id: "day-2" },
        daily_pick_products: { product_variety_id: LEMON, product_varieties: CITRUS_ROW },
        daily_order_products: null,
      },
    ],
  };
  const { history, familyOf } = historyFromRows(rows);
  const dayOf = (date: string) => history.find((day) => day.date === date);

  it("counts a closed day's stock as what was left when it closed plus what was arranged off it", () => {
    // 1 left + 5 arranged = the 6 picked that day.
    expect(dayOf("2026-10-02")?.supply).toEqual({ [LEMON]: 6 });
  });

  it("counts an open day's stock as picked plus what was carried into it", () => {
    expect(dayOf("2026-10-03")?.supply).toEqual({ [LIME]: 5 });
  });

  it("does not add an open day's allocations to its stock: they are already inside picked + leftover", () => {
    const withRecord = historyFromRows({
      ...rows,
      records: [
        ...rows.records,
        {
          quantity_pallets: "2",
          customer_company_id: "gabbai",
          daily_arrangements: { trading_day_id: "day-3" },
          daily_pick_products: { product_variety_id: LIME, product_varieties: CITRUS_ROW },
          daily_order_products: null,
        },
      ],
    });

    expect(withRecord.history.find((day) => day.date === "2026-10-03")?.supply).toEqual({
      [LIME]: 5,
    });
  });

  it("keeps only order lines and allocations above zero", () => {
    expect(dayOf("2026-10-02")?.orders).toEqual({ [LEMON]: { gabbai: 9 } });
  });

  it("reads whose an allocation was off its order line, and off the record's own copy only without one", () => {
    expect(dayOf("2026-10-02")?.recorded).toEqual({ [LEMON]: { gabbai: 4, atara: 1 } });
  });

  it("puts the days in date order, keeping a day with nothing on it", () => {
    expect(history.map((day) => day.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("collects each product's family as it goes", () => {
    expect(familyOf).toEqual({ [LEMON]: CITRUS, [LIME]: CITRUS });
  });
});

describe("readAllPages", () => {
  const rows = Array.from({ length: 7 }, (_, index) => index);

  it("reads on until a page comes back empty, even when the server returns fewer rows than asked", async () => {
    const asked: Array<[number, number]> = [];
    const read = await readAllPages(async (from, to) => {
      asked.push([from, to]);
      // A server capped at 2 rows a page, whatever the range asked for.
      return rows.slice(from, Math.min(to + 1, from + 2));
    }, 5);

    expect(read).toEqual(rows);
    expect(asked.map(([from]) => from)).toEqual([0, 2, 4, 6, 7]);
  });

  it("asks once when there is nothing", async () => {
    let calls = 0;
    const read = await readAllPages(async () => {
      calls += 1;
      return [];
    });

    expect(read).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe("dayToPropose", () => {
  const picks: BoardPick[] = [
    {
      id: "pick-a",
      grower_company_id: "grower-a",
      status: "submitted",
      pickup_time: null,
      daily_pick_products: [
        {
          id: "line-a-lemon",
          daily_pick_id: "pick-a",
          product_variety_id: LEMON,
          pallets_picked: "5",
          leftover_pallets: "4",
          comment: null,
          product_varieties: variety(LEMON),
        },
        {
          id: "line-a-orphan",
          daily_pick_id: "pick-a",
          product_variety_id: "variety-gone",
          pallets_picked: "9",
          leftover_pallets: "0",
          comment: null,
          product_varieties: null,
        },
      ],
    },
    {
      id: "pick-b",
      grower_company_id: "grower-b",
      status: "submitted",
      pickup_time: null,
      daily_pick_products: [
        {
          id: "line-b-lemon",
          daily_pick_id: "pick-b",
          product_variety_id: LEMON,
          pallets_picked: "1",
          leftover_pallets: "0",
          comment: null,
          product_varieties: variety(LEMON),
        },
      ],
    },
  ];
  const orders: BoardOrder[] = [
    {
      id: "order-gabbai",
      customer_company_id: "gabbai",
      status: "submitted",
      // Submitted twice: the time that counts is the first.
      submitted_at: "2026-10-12T09:00:00+00:00",
      order_submission_logs: [
        { id: "log-2", created_at: "2026-10-12T09:00:00+00:00", snapshot: [] },
        { id: "log-1", created_at: "2026-10-12T06:00:00+00:00", snapshot: [] },
      ],
      daily_order_products: [
        {
          id: "ol-gabbai-lemon",
          daily_order_id: "order-gabbai",
          product_variety_id: LEMON,
          pallets_ordered: "3",
          comment: null,
          created_at: "2026-10-12T05:00:00+00:00",
          product_varieties: variety(LEMON),
        },
        {
          id: "ol-gabbai-lime",
          daily_order_id: "order-gabbai",
          product_variety_id: LIME,
          pallets_ordered: "0",
          comment: null,
          created_at: "2026-10-12T05:00:00+00:00",
          product_varieties: variety(LIME),
        },
      ],
    },
    {
      id: "order-atara",
      customer_company_id: "atara",
      status: "submitted",
      submitted_at: "2026-10-12T07:00:00+00:00",
      order_submission_logs: [],
      daily_order_products: [
        {
          id: "ol-atara-lemon",
          daily_order_id: "order-atara",
          product_variety_id: LEMON,
          pallets_ordered: "1",
          comment: null,
          created_at: "2026-10-12T04:00:00+00:00",
          product_varieties: variety(LEMON),
        },
      ],
    },
    {
      id: "order-kahlon",
      customer_company_id: "kahlon",
      status: "open",
      submitted_at: null,
      order_submission_logs: [],
      daily_order_products: [
        {
          id: "ol-kahlon-lemon",
          daily_order_id: "order-kahlon",
          product_variety_id: LEMON,
          pallets_ordered: "2",
          comment: null,
          created_at: "2026-10-12T03:00:00+00:00",
          product_varieties: variety(LEMON),
        },
      ],
    },
  ];
  // One of grower A's pallets already went to Gabbai.
  const records: BoardRecord[] = [
    {
      id: "record-1",
      daily_pick_product_id: "line-a-lemon",
      daily_order_product_id: "ol-gabbai-lemon",
      customer_company_id: "gabbai",
      quantity_pallets: 1,
      price: null,
      price_type: null,
    },
  ];
  const day = dayToPropose({ tradeDate: "2026-10-12", picks, orders, records });

  it("offers what is free on each lot — picked plus carried-in leftover, less what is arranged — as the grid's זמין does", () => {
    expect(day.lots).toEqual([
      { growerId: "grower-a", varietyId: LEMON, available: 8 },
      { growerId: "grower-b", varietyId: LEMON, available: 1 },
    ]);
  });

  it("never offers less than nothing", () => {
    const over = dayToPropose({
      tradeDate: "2026-10-12",
      picks,
      orders,
      records: [{ ...records[0]!, quantity_pallets: 20 }],
    });

    expect(over.lots[0]).toEqual({ growerId: "grower-a", varietyId: LEMON, available: 0 });
  });

  it("dates an order by its first submission, then its last, then the time its line was written", () => {
    expect(day.orders).toEqual([
      {
        customerId: "gabbai",
        varietyId: LEMON,
        quantity: 3,
        orderedAt: "2026-10-12T06:00:00+00:00",
      },
      {
        customerId: "atara",
        varietyId: LEMON,
        quantity: 1,
        orderedAt: "2026-10-12T07:00:00+00:00",
      },
      {
        customerId: "kahlon",
        varietyId: LEMON,
        quantity: 2,
        orderedAt: "2026-10-12T03:00:00+00:00",
      },
    ]);
  });

  it("names the lot, product and customer of every saved allocation", () => {
    expect(day.arranged).toEqual([
      { growerId: "grower-a", varietyId: LEMON, customerId: "gabbai", quantity: 1 },
    ]);
  });

  it("reads a saved allocation's customer off its order line, not off the record's own copy", () => {
    const copyDisagrees = dayToPropose({
      tradeDate: "2026-10-12",
      picks,
      orders,
      records: [{ ...records[0]!, customer_company_id: "someone-else" }],
    });

    expect(copyDisagrees.arranged[0]?.customerId).toBe("gabbai");
  });

  it("lists a saved cell of zero pallets too: it is taken all the same", () => {
    const empty = dayToPropose({
      tradeDate: "2026-10-12",
      picks,
      orders,
      records: [{ ...records[0]!, quantity_pallets: 0 }],
    });

    expect(empty.arranged).toEqual([
      { growerId: "grower-a", varietyId: LEMON, customerId: "gabbai", quantity: 0 },
    ]);
  });

  it("carries the day's date", () => {
    expect(day.date).toBe("2026-10-12");
  });
});

describe("customerFactsFrom", () => {
  it("gives every customer their score, when they have one, and the day they were created", () => {
    const facts = customerFactsFrom({
      customers: [
        { id: "gabbai", created_at: "2025-03-01T10:00:00+00:00" },
        { id: "atara", created_at: "2026-10-01T23:30:00+00:00" },
      ],
      scores: [{ customer_company_id: "gabbai", general_score: "4.35" }],
    });

    expect(facts).toEqual({
      gabbai: { generalScore: 4.35, since: "2025-03-01" },
      atara: { generalScore: null, since: "2026-10-01" },
    });
  });
});
