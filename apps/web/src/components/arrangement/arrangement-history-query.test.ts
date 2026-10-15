import { describe, expect, it } from "vitest";

import { readEngineHistory } from "./arrangement-history-query";

type Client = Parameters<typeof readEngineHistory>[0];
type Row = Record<string, unknown>;
type Call = { method: string; args: unknown[] };
type Reply = { data: Row[] | null; error: { message: string } | null };

interface TableSpec {
  rows: Row[];
  /** Fails every request that starts at this row or later; 0 fails them all. */
  failFrom?: number;
}

// "a, b!inner(c), d(e(f))" as { a: true, b: { c: true }, d: { e: { f: true } } }.
type Shape = { [column: string]: true | Shape };

function shapeOf(select: string): Shape {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at <= select.length; at += 1) {
    if (select[at] === "(") depth += 1;
    if (select[at] === ")") depth -= 1;
    if (at === select.length || (select[at] === "," && depth === 0)) {
      items.push(select.slice(start, at).trim());
      start = at + 1;
    }
  }
  const shape: Shape = {};
  for (const item of items) {
    const open = item.indexOf("(");
    if (open === -1) shape[item] = true;
    else shape[item.slice(0, open).replace("!inner", "")] = shapeOf(item.slice(open + 1, -1));
  }
  return shape;
}

// Only the columns asked for, as PostgREST returns them.
function project(row: Row, shape: Shape): Row {
  const out: Row = {};
  for (const [column, inner] of Object.entries(shape)) {
    const value = row[column];
    out[column] = inner === true || value === null ? value : project(value as Row, inner);
  }
  return out;
}

// The slice of supabase-js's query builder that readEngineHistory calls, over
// rows held in memory. It applies no filter — the tests assert which filters
// were asked for, not what a database would do with them. Like the real thing,
// it returns only the columns the select names, at most `maxRows` rows to a
// request (PostgREST's max_rows), and it cannot page a query that is not
// ordered: pages of an unordered query overlap and skip rows.
class FakeQuery implements PromiseLike<Reply> {
  readonly calls: Call[] = [];
  private window: [from: number, to: number] | null = null;

  constructor(
    readonly table: string,
    private readonly source: TableSpec,
    private readonly maxRows: number,
  ) {}

  select = (...args: unknown[]) => this.note("select", args);
  gte = (...args: unknown[]) => this.note("gte", args);
  lt = (...args: unknown[]) => this.note("lt", args);
  in = (...args: unknown[]) => this.note("in", args);
  or = (...args: unknown[]) => this.note("or", args);
  gt = (...args: unknown[]) => this.note("gt", args);
  eq = (...args: unknown[]) => this.note("eq", args);
  order = (...args: unknown[]) => this.note("order", args);

  range(from: number, to: number) {
    if (!this.calls.some((call) => call.method === "order")) {
      throw new Error(`${this.table}: paged without an order`);
    }
    this.window = [from, to];
    return this.note("range", [from, to]);
  }

  then<Fulfilled = Reply, Rejected = never>(
    onfulfilled?: ((reply: Reply) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): PromiseLike<Fulfilled | Rejected> {
    return Promise.resolve(this.reply()).then(onfulfilled, onrejected);
  }

  private note(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }

  private reply(): Reply {
    const start = this.window?.[0] ?? 0;
    if (this.source.failFrom !== undefined && start >= this.source.failFrom) {
      return { data: null, error: { message: `${this.table} failed` } };
    }
    const end = this.window ? Math.min(this.window[1] + 1, start + this.maxRows) : undefined;
    const select = this.calls.find((call) => call.method === "select");
    const shape = shapeOf(String(select?.args[0]));
    return {
      data: this.source.rows.slice(start, end).map((row) => project(row, shape)),
      error: null,
    };
  }
}

function fakeSupabase(tables: Record<string, TableSpec>, { maxRows = Infinity } = {}) {
  const queries: FakeQuery[] = [];
  const client = {
    from(table: string) {
      const query = new FakeQuery(table, tables[table] ?? { rows: [] }, maxRows);
      queries.push(query);
      return query;
    },
  };
  return { client: client as unknown as Client, queries };
}

const callsTo = (query: FakeQuery, method: string) =>
  query.calls.filter((call) => call.method === method);
const queryOf = (queries: readonly FakeQuery[], table: string) =>
  queries.find((query) => query.table === table)!;

const LEMON = "variety-lemon";
const FIG = "variety-fig";
const PLUM = "variety-plum";
const MELON = "variety-melon";
const CITRUS = "family-citrus";
const FRUIT = "family-fruit";
const STONE = "family-stone";
const GOURD = "family-gourd";
const family = (id: string) => ({ family_id: id });

// Two days of the window — 1.10 closed, 2.10 never arranged — with three rows in
// every table that is read page by page. Lemons are in all of them; the third
// row of each is a product that only that table knows the family of.
const days: Row[] = [
  { id: "day-1", trade_date: "2026-10-01", daily_arrangements: { status: "closed" } },
  { id: "day-2", trade_date: "2026-10-02", daily_arrangements: null },
];
const world: Record<string, TableSpec> = {
  trading_days: { rows: days },
  daily_pick_products: {
    rows: [
      {
        id: "pick-1",
        product_variety_id: LEMON,
        pallets_picked: "4",
        leftover_pallets: "1",
        daily_picks: { trading_day_id: "day-1" },
        product_varieties: family(CITRUS),
      },
      {
        id: "pick-2",
        product_variety_id: LEMON,
        pallets_picked: "2",
        leftover_pallets: "2",
        daily_picks: { trading_day_id: "day-1" },
        product_varieties: family(CITRUS),
      },
      {
        id: "pick-3",
        product_variety_id: FIG,
        pallets_picked: "3",
        leftover_pallets: "1",
        daily_picks: { trading_day_id: "day-2" },
        product_varieties: family(FRUIT),
      },
    ],
  },
  daily_order_products: {
    rows: [
      {
        id: "order-1",
        product_variety_id: LEMON,
        pallets_ordered: "3",
        daily_orders: { trading_day_id: "day-1", customer_company_id: "gabbai" },
        product_varieties: family(CITRUS),
      },
      {
        id: "order-2",
        product_variety_id: LEMON,
        pallets_ordered: "2",
        daily_orders: { trading_day_id: "day-1", customer_company_id: "atara" },
        product_varieties: family(CITRUS),
      },
      {
        id: "order-3",
        product_variety_id: PLUM,
        pallets_ordered: "1",
        daily_orders: { trading_day_id: "day-2", customer_company_id: "gabbai" },
        product_varieties: family(STONE),
      },
    ],
  },
  arrangement_records: {
    rows: [
      {
        id: "record-1",
        quantity_pallets: "1",
        // The record's own copy is stale; its order line's owner is the one that counts.
        customer_company_id: "stale-copy",
        daily_arrangements: { trading_day_id: "day-1" },
        daily_pick_products: { product_variety_id: LEMON, product_varieties: family(CITRUS) },
        daily_order_products: { daily_orders: { customer_company_id: "gabbai" } },
      },
      {
        id: "record-2",
        quantity_pallets: "2",
        customer_company_id: "atara",
        daily_arrangements: { trading_day_id: "day-1" },
        daily_pick_products: { product_variety_id: LEMON, product_varieties: family(CITRUS) },
        daily_order_products: null,
      },
      {
        id: "record-3",
        quantity_pallets: "4",
        customer_company_id: "gabbai",
        daily_arrangements: { trading_day_id: "day-2" },
        daily_pick_products: { product_variety_id: MELON, product_varieties: family(GOURD) },
        daily_order_products: null,
      },
    ],
  },
  customer_scores: {
    rows: [
      { customer_company_id: "atara", general_score: "3.00" },
      { customer_company_id: "dana", general_score: "2.25" },
      { customer_company_id: "gabbai", general_score: "4.50" },
    ],
  },
  companies: {
    rows: [
      { id: "atara", created_at: "2026-10-01T23:30:00+00:00" },
      { id: "dana", created_at: "2024-01-15T08:00:00+00:00" },
      { id: "gabbai", created_at: "2025-03-01T10:00:00+00:00" },
    ],
  },
};
// What those rows make, worked out by hand. A closed day's stock is what was
// left plus what was arranged off it (1 + 2 + 1 + 2 = 6); an open one's, picked
// plus carried in.
const learned = {
  history: [
    {
      date: "2026-10-01",
      supply: { [LEMON]: 6 },
      orders: { [LEMON]: { gabbai: 3, atara: 2 } },
      recorded: { [LEMON]: { gabbai: 1, atara: 2 } },
    },
    {
      date: "2026-10-02",
      supply: { [FIG]: 4 },
      orders: { [PLUM]: { gabbai: 1 } },
      recorded: { [MELON]: { gabbai: 4 } },
    },
  ],
  familyOf: { [LEMON]: CITRUS, [FIG]: FRUIT, [PLUM]: STONE, [MELON]: GOURD },
  customers: {
    atara: { generalScore: 3, since: "2026-10-01" },
    dana: { generalScore: 2.25, since: "2024-01-15" },
    gabbai: { generalScore: 4.5, since: "2025-03-01" },
  },
};
const tradeDate = "2026-10-12";

describe("readEngineHistory", () => {
  it("reads the 60 days before the trade date, and not the trade date itself", async () => {
    const { client, queries } = fakeSupabase({});

    await readEngineHistory(client, "2026-10-12");
    await readEngineHistory(client, "2026-03-01");

    const [first, second] = queries.filter((query) => query.table === "trading_days");
    expect(first!.calls).toContainEqual({ method: "gte", args: ["trade_date", "2026-08-13"] });
    expect(first!.calls).toContainEqual({ method: "lt", args: ["trade_date", "2026-10-12"] });
    // Across a year end.
    expect(second!.calls).toContainEqual({ method: "gte", args: ["trade_date", "2025-12-31"] });
    expect(second!.calls).toContainEqual({ method: "lt", args: ["trade_date", "2026-03-01"] });
  });

  it("hands back the days, the products' families and the customers' facts the rows make", async () => {
    const { client } = fakeSupabase(world);

    expect(await readEngineHistory(client, tradeDate)).toEqual(learned);
  });

  it("reads every page of every paged table, on until a page comes back empty, even when the server returns fewer rows than asked", async () => {
    const { client } = fakeSupabase(world, { maxRows: 2 });

    expect(await readEngineHistory(client, tradeDate)).toEqual(learned);
  });

  it("asks for the lots, order lines and allocations of the days it read, and of no others", async () => {
    const { client, queries } = fakeSupabase(world);

    await readEngineHistory(client, tradeDate);

    for (const table of ["daily_pick_products", "daily_order_products", "arrangement_records"]) {
      const query = queryOf(queries, table);
      const [column, ids] = callsTo(query, "in")[0]!.args as [string, string[]];
      expect(ids).toEqual(["day-1", "day-2"]);
      // A filter on an embedded table only drops the rows that do not match
      // when that table is joined inner; otherwise it just blanks the embed.
      const embedded = column.split(".")[0];
      expect(String(callsTo(query, "select")[0]!.args[0])).toContain(`${embedded}!inner(`);
    }
  });

  it("asks only for lots, order lines and allocations that have pallets on them", async () => {
    const { client, queries } = fakeSupabase(world);

    await readEngineHistory(client, tradeDate);

    const lots = String(callsTo(queryOf(queries, "daily_pick_products"), "or")[0]!.args[0]);
    expect(lots).toContain("pallets_picked.gt.0");
    expect(lots).toContain("leftover_pallets.gt.0");
    expect(callsTo(queryOf(queries, "daily_order_products"), "gt")).toContainEqual({
      method: "gt",
      args: ["pallets_ordered", 0],
    });
    expect(callsTo(queryOf(queries, "arrangement_records"), "gt")).toContainEqual({
      method: "gt",
      args: ["quantity_pallets", 0],
    });
  });

  it("reads customers only: the companies table holds growers too", async () => {
    const { client, queries } = fakeSupabase(world);

    await readEngineHistory(client, tradeDate);

    expect(callsTo(queryOf(queries, "companies"), "eq")).toContainEqual({
      method: "eq",
      args: ["type", "customer"],
    });
  });

  it("reads no lots, order lines or allocations when no trading day lies in the window", async () => {
    const { client, queries } = fakeSupabase({ ...world, trading_days: { rows: [] } });

    const read = await readEngineHistory(client, tradeDate);

    expect([...new Set(queries.map((query) => query.table))].sort()).toEqual([
      "companies",
      "customer_scores",
      "trading_days",
    ]);
    expect(read.history).toEqual([]);
    expect(read.customers).toEqual(learned.customers);
  });

  describe("throws what the database answered when a read fails", () => {
    it("on the trading_days read", async () => {
      const { client } = fakeSupabase({
        ...world,
        trading_days: { ...world.trading_days!, failFrom: 0 },
      });

      await expect(readEngineHistory(client, tradeDate)).rejects.toMatchObject({
        message: "trading_days failed",
      });
    });

    // A table of three rows, two to a page: failing from row 2 spares the
    // first page and fails the second.
    describe.each([
      ["on the first page", 0],
      ["on a later page", 2],
    ])("%s", (_, failFrom) => {
      it.each([
        "daily_pick_products",
        "daily_order_products",
        "arrangement_records",
        "customer_scores",
        "companies",
      ])("of %s", async (table) => {
        const { client } = fakeSupabase(
          { ...world, [table]: { ...world[table]!, failFrom } },
          { maxRows: 2 },
        );

        await expect(readEngineHistory(client, tradeDate)).rejects.toMatchObject({
          message: `${table} failed`,
        });
      });
    });
  });
});
