// What the arrangement engine reads, out of what the database returns — no
// React, no Supabase. The queries themselves are the screen's
// (routes/backoffice/new-arrangement.tsx) and arrangement-history-query.ts's;
// this file reshapes their rows into arrangement-engine.ts's terms, and runs
// the engine on the day on screen (proposeForDay), so that both can be tested.
//
// Stock is read the way the app itself counts it — and leftover_pallets means
// two different things depending on the day (migration 0050):
//
//   a day still open   leftover is what was CARRIED IN from the grower's day
//                      before, on top of today's pick: stock = picked +
//                      leftover, and what is free is that less what is
//                      arranged — the grid's זמין.
//   a day closed       close_arrangement overwrote leftover with what was LEFT
//                      at the end: the stock the day started with is that plus
//                      what was arranged off it.
//
// Replayed over the owner's October days, reading closed days this way gives
// exactly the proof of concept's results, which counted picked pallets only.
import {
  learnFrom,
  proposeArrangement,
  type CustomerFacts,
  type DayToPropose,
  type HistoryDay,
} from "./arrangement-engine";
import type { ProposalLine } from "./arrangement-proposal";
import { parsePallets, type BoardOrder, type BoardPick, type BoardRecord } from "./board-data";

type FamilyRow = { family_id: string } | null;

/** The history query's rows: the window's days, and their lots, order lines and allocations. */
export interface HistoryRows {
  days: ReadonlyArray<{
    id: string;
    trade_date: string;
    daily_arrangements: { status: string } | null;
  }>;
  /** Lots with something on them (picked or leftover above zero). */
  pickLines: ReadonlyArray<{
    product_variety_id: string;
    pallets_picked: string | number;
    leftover_pallets: string | number;
    daily_picks: { trading_day_id: string };
    product_varieties: FamilyRow;
  }>;
  orderLines: ReadonlyArray<{
    product_variety_id: string;
    pallets_ordered: string | number;
    daily_orders: { trading_day_id: string; customer_company_id: string };
    product_varieties: FamilyRow;
  }>;
  records: ReadonlyArray<{
    quantity_pallets: string | number;
    /** A copy of whose it is; the order line's owner is the authoritative one. */
    customer_company_id: string;
    daily_arrangements: { trading_day_id: string };
    daily_pick_products: { product_variety_id: string; product_varieties: FamilyRow } | null;
    daily_order_products: { daily_orders: { customer_company_id: string } | null } | null;
  }>;
}

/** Past days in the engine's terms, oldest first, with every product's family met on the way. */
export function historyFromRows(rows: HistoryRows): {
  history: HistoryDay[];
  familyOf: Record<string, string>;
} {
  const familyOf: Record<string, string> = {};
  const noteFamily = (varietyId: string, row: FamilyRow) => {
    if (row) familyOf[varietyId] = row.family_id;
  };

  const byId = new Map<string, HistoryDay & { closed: boolean }>();
  for (const day of rows.days) {
    byId.set(day.id, {
      date: day.trade_date,
      closed: day.daily_arrangements?.status === "closed",
      supply: {},
      orders: {},
      recorded: {},
    });
  }

  for (const line of rows.pickLines) {
    const day = byId.get(line.daily_picks.trading_day_id);
    if (!day) continue;
    noteFamily(line.product_variety_id, line.product_varieties);
    // Closed: what was left; what was arranged is added with the records below.
    const stock = day.closed
      ? parsePallets(line.leftover_pallets)
      : parsePallets(line.pallets_picked) + parsePallets(line.leftover_pallets);
    add(day.supply, line.product_variety_id, stock);
  }

  for (const line of rows.orderLines) {
    const day = byId.get(line.daily_orders.trading_day_id);
    const pallets = parsePallets(line.pallets_ordered);
    if (!day || pallets <= 0) continue;
    noteFamily(line.product_variety_id, line.product_varieties);
    add(
      (day.orders[line.product_variety_id] ??= {}),
      line.daily_orders.customer_company_id,
      pallets,
    );
  }

  for (const record of rows.records) {
    const day = byId.get(record.daily_arrangements.trading_day_id);
    const lot = record.daily_pick_products;
    const pallets = parsePallets(record.quantity_pallets);
    if (!day || !lot || pallets <= 0) continue;
    noteFamily(lot.product_variety_id, lot.product_varieties);
    if (day.closed) add(day.supply, lot.product_variety_id, pallets);
    // Off the order line, as buildMatrix reads it; the record's own copy
    // only for a line that did not come back.
    const customerId =
      record.daily_order_products?.daily_orders?.customer_company_id ?? record.customer_company_id;
    add((day.recorded[lot.product_variety_id] ??= {}), customerId, pallets);
  }

  const history = [...byId.values()]
    .map(({ date, supply, orders, recorded }) => ({ date, supply, orders, recorded }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { history, familyOf };
}

/**
 * Every row of a query, page by page. Reads on until a page comes back
 * EMPTY rather than short: the server may cap a page below the size asked
 * for (PostgREST's max_rows), and stopping at the first short page would
 * quietly drop the rest. `readPage` must order its rows stably.
 */
export async function readAllPages<T>(
  readPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await readPage(rows.length, rows.length + pageSize - 1);
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}

function add(totals: Record<string, number>, key: string, value: number) {
  totals[key] = (totals[key] ?? 0) + value;
}

/**
 * The day on screen, in the engine's terms: what is still free on each lot
 * (picked + carried-in leftover − arranged, the grid's זמין), who ordered what
 * and when, and what is already arranged.
 *
 * A lot whose product did not come back has no row on the grid, so it is not
 * offered — the same rule buildMatrix and resolveProposal apply.
 */
export function dayToPropose({
  tradeDate,
  picks,
  orders,
  records,
}: {
  tradeDate: string;
  picks: readonly BoardPick[];
  orders: readonly BoardOrder[];
  records: readonly BoardRecord[];
}): DayToPropose {
  const lotOf = new Map<string, { growerId: string; varietyId: string }>();
  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      if (line.product_varieties) {
        lotOf.set(line.id, {
          growerId: pick.grower_company_id,
          varietyId: line.product_varieties.id,
        });
      }
    }
  }

  const owner = new Map<string, string>();
  for (const order of orders) {
    for (const line of order.daily_order_products) owner.set(line.id, order.customer_company_id);
  }

  const takenOff = new Map<string, number>();
  const arranged: DayToPropose["arranged"] = [];
  for (const record of records) {
    const quantity = parsePallets(record.quantity_pallets);
    takenOff.set(
      record.daily_pick_product_id,
      (takenOff.get(record.daily_pick_product_id) ?? 0) + quantity,
    );
    const lot = lotOf.get(record.daily_pick_product_id);
    // A record of zero pallets is listed too: its cell is taken all the same.
    if (!lot) continue;
    arranged.push({
      ...lot,
      customerId: owner.get(record.daily_order_product_id) ?? record.customer_company_id,
      quantity,
    });
  }

  const lots: DayToPropose["lots"] = [];
  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      const lot = lotOf.get(line.id);
      if (!lot) continue;
      const free =
        parsePallets(line.pallets_picked) +
        parsePallets(line.leftover_pallets) -
        (takenOff.get(line.id) ?? 0);
      lots.push({ ...lot, available: Math.max(0, free) });
    }
  }

  const ordered: DayToPropose["orders"] = [];
  for (const order of orders) {
    for (const line of order.daily_order_products) {
      const quantity = parsePallets(line.pallets_ordered);
      if (quantity <= 0) continue;
      ordered.push({
        customerId: order.customer_company_id,
        varietyId: line.product_varieties?.id ?? line.product_variety_id,
        quantity,
        orderedAt: firstSubmission(order) ?? order.submitted_at ?? line.created_at ?? "",
      });
    }
  }

  return { date: tradeDate, lots, orders: ordered, arranged };
}

/**
 * "הצע סידור" on the day on screen: the engine's proposal, worked out from the
 * day as it stands and what the history taught (arrangement-history-query.ts).
 *
 * The day's own products' families are added to the history's: a product
 * first sold today is in no past day, and without its family it would be
 * judged with no habits at all.
 *
 * Every line comes back marked suggested, so that each later read of the day
 * holds it to what the customer still has on order (see resolveProposal).
 */
export function proposeForDay({
  tradeDate,
  picks,
  orders,
  records,
  learnedFrom,
}: {
  tradeDate: string;
  picks: readonly BoardPick[];
  orders: readonly BoardOrder[];
  records: readonly BoardRecord[];
  learnedFrom: {
    history: readonly HistoryDay[];
    familyOf: Readonly<Record<string, string>>;
    customers: Readonly<Record<string, CustomerFacts>>;
  };
}): ProposalLine[] {
  const familyOf: Record<string, string> = { ...learnedFrom.familyOf };
  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      if (line.product_varieties)
        familyOf[line.product_varieties.id] = line.product_varieties.family_id;
    }
  }
  return proposeArrangement({
    day: dayToPropose({ tradeDate, picks, orders, records }),
    learned: learnFrom(learnedFrom.history, familyOf),
    familyOf,
    customers: learnedFrom.customers,
  }).map((line) => ({ ...line, origin: "suggested" as const }));
}

/**
 * When the customer FIRST submitted the order. submitted_at is reset on every
 * submission (submit_order, 0040), so it says who submitted last — and a
 * customer who corrects their order would lose their place to it.
 */
function firstSubmission(order: BoardOrder): string | undefined {
  let first: string | undefined;
  for (const log of order.order_submission_logs ?? []) {
    if (first === undefined || Date.parse(log.created_at) < Date.parse(first))
      first = log.created_at;
  }
  return first;
}

/** Each customer's score and the day they were created, for the engine's ranking. */
export function customerFactsFrom({
  customers,
  scores,
}: {
  customers: ReadonlyArray<{ id: string; created_at: string }>;
  scores: ReadonlyArray<{ customer_company_id: string; general_score: string | number }>;
}): Record<string, CustomerFacts> {
  // numeric(3,2) arrives as text. Anything unreadable is no score at all
  // rather than a zero, which would rank the customer below "not scored".
  const scoreOf = new Map<string, number>();
  for (const row of scores) {
    const score = Number(row.general_score);
    if (Number.isFinite(score)) scoreOf.set(row.customer_company_id, score);
  }
  return Object.fromEntries(
    customers.map((customer) => [
      customer.id,
      { generalScore: scoreOf.get(customer.id) ?? null, since: customer.created_at.slice(0, 10) },
    ]),
  );
}
