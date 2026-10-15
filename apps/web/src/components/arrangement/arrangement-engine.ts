// The arrangement ENGINE: what "הצע סידור" proposes for a day — no React, no
// Supabase.
//
// The rules are the owner's (Lior Harpaz's spec of 2026-09-24 and the meeting
// of 2026-10-03), in the form a proof of concept measured closest to what he
// actually does: run blind over October's real days, it proposed the same
// pallets as he did for 86% of what it proposed, and 85% of the pallets of
// products that ran short (Ori/arrangement-poc, poc/engine.py's
// propose_adaptive). This file is that proof of concept carried over rule for
// rule; arrangement-engine.test.ts carries its tests.
//
// Per product (variety), for the customers who ordered it:
//
//   enough stock    everyone gets what they ordered;
//   not enough      one pallet each before anyone gets a second, round after
//                   round, in RANK order, until the stock runs out.
//
// A customer's rank for a product, compared left to right:
//
//   1. how they fared the last SHORTAGE_MEMORY times this exact product ran
//      short: +1 for each time they were served, −1 for each time they
//      ordered and were not. This is how the engine learns from the owner's
//      corrections — he gives it to someone else twice, and the third
//      proposal follows him.
//   2. on how many days of the history they were given this exact product.
//   3. the owner's own priority: half his general score for the customer
//      (customer_scores), half how habitually they buy the product's family.
//   4. whoever ordered first.
//
// Then the pallets dealt to each customer are put on a grower's lot — the lot
// with the most left, a customer kept on one lot unless none has enough.
//
// What it never does: give a customer more than they ordered, give anything
// to a customer who did not order the product, or touch a cell that already
// holds a saved allocation — those are the distributor's own decisions, and
// a proposal works around them (see `arranged` on DayToPropose).
//
// Kept free of React and of the network, like matrix-data.ts, so that what
// the screen proposes can be checked against the owner's examples and
// against the days he has already arranged.
import type { ProposalLine } from "./arrangement-proposal";

/** How many of a product's past shortages a customer is judged on. */
export const SHORTAGE_MEMORY = 3;
/** A customer this new is ranked on their general score alone: they have no habits yet. */
export const NEWCOMER_DAYS = 30;
/** The general score of a customer the owner has not scored — "nothing known", not "bad". */
export const UNRANKED_SCORE = 1;

// The owner's bands: the share of a family's selling days on which the
// customer ordered or was given it → his 1–5 product score.
const SHARE_BANDS: ReadonlyArray<readonly [floor: number, score: number]> = [
  [0.6, 5],
  [0.4, 4],
  [0.2, 3],
  [0.05, 2],
];

const DAY_MS = 86_400_000;

/** One past trading day, reduced to what the engine learns from. Only quantities above zero. */
export interface HistoryDay {
  /** YYYY-MM-DD. */
  date: string;
  /** variety → pallets in stock that day, every grower's together. */
  supply: Record<string, number>;
  /** variety → customer → pallets ordered. */
  orders: Record<string, Record<string, number>>;
  /** variety → customer → pallets arranged. */
  recorded: Record<string, Record<string, number>>;
}

/** What the history taught. See learnFrom. */
export interface Learned {
  /** customer → family → share of the days the family sold on which they ordered or were given it. */
  shares: Record<string, Record<string, number>>;
  /** customer → variety → days they were given that exact variety. */
  received: Record<string, Record<string, number>>;
  /** customer → variety → +1 served / −1 ordered and not served, per past shortage, oldest first. */
  shortages: Record<string, Record<string, number[]>>;
}

/** The day being proposed for, as it stands. */
export interface DayToPropose {
  /** YYYY-MM-DD. */
  date: string;
  /** Every grower's lot of every product, with what is still free on it. */
  lots: Array<{ growerId: string; varietyId: string; available: number }>;
  /** Order lines above zero. `orderedAt` breaks a tie in rank: the earlier order goes first. */
  orders: Array<{ customerId: string; varietyId: string; quantity: number; orderedAt: string }>;
  /** Saved allocations: what the customer already has, and cells a proposal must not touch. */
  arranged: Array<{ growerId: string; varietyId: string; customerId: string; quantity: number }>;
}

/** What the engine knows about a customer apart from their history. */
export interface CustomerFacts {
  /** The owner's 1–5 score, or null when he has not given one. */
  generalScore: number | null;
  /** YYYY-MM-DD the customer was created, or null when not known. */
  since: string | null;
}

/** A customer's order for one product, ranked for dealing — see dealInRounds. */
export interface RankedOrder {
  customerId: string;
  quantity: number;
  /** Compared left to right, higher first. */
  rank: readonly number[];
  orderedAt: string;
}

/** A lot to put pallets on — see assignLots. */
export interface LotToFill {
  growerId: string;
  available: number;
  /** Customers whose cell on this lot already holds a saved allocation. */
  takenBy?: ReadonlySet<string>;
}

/** The owner's 1–5 product score for buying a family on `share` of the days it sold. */
export function productScore(share: number): number {
  for (const [floor, score] of SHARE_BANDS) {
    if (share >= floor) return score;
  }
  return 1;
}

/** The owner's priority: half his general score, half the product score. */
export function ownerPriority(general: number, product: number): number {
  return 0.5 * general + 0.5 * product;
}

/**
 * Pallets per customer for one product. Everyone gets their order when the
 * stock covers it; otherwise one pallet each, in rank order, round after
 * round, until the stock is gone. The earlier order goes first between two
 * equal ranks.
 *
 * One round for everybody, not the owner's written two tiers (customers above
 * 3.5 filled first): measured over October, the single round was closer to
 * what he does — his worked peach example comes out differently for exactly
 * that reason (see the test).
 */
export function dealInRounds(
  supply: number,
  orders: readonly RankedOrder[],
  /**
   * Whether these pallets per customer can all be put on lots. By default
   * whenever they add up to no more than the stock; proposeArrangement passes
   * an exact check when saved cells shut some customers out of some lots.
   */
  canPlace: (granted: Readonly<Record<string, number>>) => boolean = (granted) =>
    Object.values(granted).reduce((sum, pallets) => sum + pallets, 0) <= supply,
): Record<string, number> {
  const granted: Record<string, number> = {};
  for (const order of orders) granted[order.customerId] = 0;

  const everything: Record<string, number> = {};
  for (const order of orders) everything[order.customerId] = order.quantity;
  if (canPlace(everything)) return everything;

  // Earliest first, then best rank first: the sort is stable, so of two equal
  // ranks the earlier order stays ahead — and of two equal in both, the one
  // with the lower id, so the outcome never rests on the order rows arrive in.
  const ranked = [...orders]
    .sort(
      (a, b) => compareTimes(a.orderedAt, b.orderedAt) || compareText(a.customerId, b.customerId),
    )
    .sort((a, b) => compareRanks(b.rank, a.rank));

  // One pallet at a time, round after round. A customer who cannot be given
  // one more — no lot open to them has room for it beside everyone else's —
  // drops out of the rounds, and the pallet goes to the next in line.
  const out = new Set<string>();
  for (;;) {
    let gave = false;
    for (const order of ranked) {
      const now = granted[order.customerId] ?? 0;
      if (out.has(order.customerId) || now >= order.quantity) continue;
      const next = { ...granted, [order.customerId]: now + 1 };
      if (!canPlace(next)) {
        out.add(order.customerId);
        continue;
      }
      granted[order.customerId] = now + 1;
      gave = true;
    }
    if (!gave) return granted;
  }
}

/**
 * What a stretch of history teaches: each customer's habit with each product
 * family, how often they were given each exact product, and how they fared
 * each time a product ran short.
 *
 * A shortage is a day the product's orders exceeded its stock AND it was
 * arranged in the app. A day it was not arranged at all says nothing about
 * who comes first — the arrangement may have been done on paper.
 */
export function learnFrom(
  history: readonly HistoryDay[],
  familyOf: Readonly<Record<string, string>>,
): Learned {
  const familyOfVariety = (varietyId: string) => familyOf[varietyId] ?? varietyId;

  const soldOn = new Map<string, Set<string>>();
  const tookOn = new Map<string, Map<string, Set<string>>>();
  const received: Learned["received"] = {};
  const shortages: Learned["shortages"] = {};

  for (const day of history) {
    for (const source of [day.orders, day.recorded]) {
      for (const [varietyId, byCustomer] of Object.entries(source)) {
        const family = familyOfVariety(varietyId);
        for (const [customerId, pallets] of Object.entries(byCustomer)) {
          if (!(pallets > 0)) continue;
          setFor(soldOn, family).add(day.date);
          setFor(mapFor(tookOn, customerId), family).add(day.date);
        }
      }
    }
    for (const [varietyId, byCustomer] of Object.entries(day.recorded)) {
      for (const [customerId, pallets] of Object.entries(byCustomer)) {
        if (!(pallets > 0)) continue;
        const counts = (received[customerId] ??= {});
        counts[varietyId] = (counts[varietyId] ?? 0) + 1;
      }
    }
  }

  // Oldest first, whatever order the days came in: "the last three" depends on it.
  for (const day of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const [varietyId, byCustomer] of Object.entries(day.orders)) {
      const recorded = day.recorded[varietyId] ?? {};
      if (!Object.values(recorded).some((pallets) => pallets > 0)) continue;
      const ordered = Object.values(byCustomer).reduce((sum, pallets) => sum + pallets, 0);
      if (ordered <= (day.supply[varietyId] ?? 0)) continue;
      for (const [customerId, pallets] of Object.entries(byCustomer)) {
        if (!(pallets > 0)) continue;
        const outcomes = ((shortages[customerId] ??= {})[varietyId] ??= []);
        outcomes.push((recorded[customerId] ?? 0) > 0 ? 1 : -1);
      }
    }
  }

  const shares: Learned["shares"] = {};
  for (const [customerId, families] of tookOn) {
    for (const [family, days] of families) {
      (shares[customerId] ??= {})[family] = days.size / (soldOn.get(family)?.size ?? days.size);
    }
  }

  return { shares, received, shortages };
}

/**
 * Puts each customer's pallets on a grower's lot: from the lot with the most
 * left, so a customer stays on one lot whenever one has enough, and is split
 * over two only when none does. A lot whose cell for the customer already
 * holds a saved allocation is passed over. Equal lots are told apart by
 * grower id, so the same day always comes out the same.
 *
 * Who goes first: the customer who can be given from the least — fewest
 * pallets on the lots open to them — so that a customer shut out of some lots
 * by their own saved cells is not left with nothing because someone who could
 * have taken from anywhere took their lot first. Among equals (which is every
 * customer on a day with nothing saved), the largest share first: it is the
 * one most worth keeping whole.
 *
 * The owner's own rule ("the grower with the most left"). Checked against his
 * recorded days it picks his grower about half the time where there was a
 * choice — but 92% of pallets are of a product only one grower picked.
 */
export function assignLots(
  lots: readonly LotToFill[],
  shares: ReadonlyArray<{ customerId: string; quantity: number }>,
): Array<{ growerId: string; customerId: string; quantity: number }> {
  const wanted = shares.reduce((sum, share) => sum + share.quantity, 0);
  const greedy = mostStockFirst(lots, shares);
  if (greedy.reduce((sum, cell) => sum + cell.quantity, 0) >= wanted) return greedy;
  // The rule of thumb left pallets over although lots had room for them —
  // a customer took the lot another could not do without. Place exactly.
  return maximumPlacement(lots, shares).cells;
}

/** The owner's rule as it stands: see assignLots. */
function mostStockFirst(
  lots: readonly LotToFill[],
  shares: ReadonlyArray<{ customerId: string; quantity: number }>,
): Array<{ growerId: string; customerId: string; quantity: number }> {
  const left = sortedLots(lots).map((lot) => ({ ...lot, left: Math.floor(lot.available) }));
  const cells: Array<{ growerId: string; customerId: string; quantity: number }> = [];
  const reach = (customerId: string) =>
    left
      .filter((lot) => !lot.takenBy?.has(customerId))
      .reduce((sum, lot) => sum + Math.max(0, lot.left), 0);
  const order = shares
    .map((share) => ({ share, reach: reach(share.customerId) }))
    .sort(
      (a, b) =>
        a.reach - b.reach ||
        b.share.quantity - a.share.quantity ||
        compareText(a.share.customerId, b.share.customerId),
    )
    .map(({ share }) => share);

  for (const share of order) {
    let need = share.quantity;
    while (need > 0) {
      let best: (typeof left)[number] | undefined;
      for (const lot of left) {
        if (lot.left <= 0 || lot.takenBy?.has(share.customerId)) continue;
        if (!best || lot.left > best.left) best = lot;
      }
      if (!best) break;
      const take = Math.min(need, best.left);
      cells.push({ growerId: best.growerId, customerId: share.customerId, quantity: take });
      best.left -= take;
      need -= take;
    }
  }
  return cells;
}

/**
 * As many pallets placed as the lots allow, each customer only on lots open
 * to them: a maximum flow from customers to lots, found one pallet at a time
 * along augmenting paths — moving an earlier pallet to another lot when that
 * frees room for this one. A day's product has a handful of lots and a few
 * dozen pallets, so this is instant.
 */
function maximumPlacement(
  lots: readonly LotToFill[],
  shares: ReadonlyArray<{ customerId: string; quantity: number }>,
): { cells: Array<{ growerId: string; customerId: string; quantity: number }>; placed: number } {
  const lotList = sortedLots(lots).map((lot) => ({ lot, room: Math.floor(lot.available) }));
  const customers = [...shares]
    .filter((share) => share.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || compareText(a.customerId, b.customerId));
  // flow[c][l] = pallets of customer c on lot l
  const flow = customers.map(() => lotList.map(() => 0));
  const used = lotList.map(() => 0);
  const open = (c: number, l: number) => !lotList[l]!.lot.takenBy?.has(customers[c]!.customerId);

  // One more pallet for customer `start`: search lots it may use; a full lot
  // may still be entered if a customer already on it can move elsewhere.
  function augment(start: number): boolean {
    const seenLot = new Set<number>();
    const seenCustomer = new Set<number>([start]);
    const fromCustomerOfLot = new Map<number, number>();
    const queue: number[] = [start];
    const cameFromLot = new Map<number, number>();
    while (queue.length > 0) {
      const c = queue.shift()!;
      for (let l = 0; l < lotList.length; l += 1) {
        if (seenLot.has(l) || !open(c, l)) continue;
        seenLot.add(l);
        fromCustomerOfLot.set(l, c);
        if (used[l]! < lotList[l]!.room) {
          // Walk back, moving one pallet along each step.
          let lot = l;
          let customer = c;
          for (;;) {
            flow[customer]![lot]! += 1;
            const previousLot = cameFromLot.get(customer);
            if (previousLot === undefined) break;
            flow[customer]![previousLot]! -= 1;
            lot = previousLot;
            customer = fromCustomerOfLot.get(lot)!;
          }
          used[l]! += 1;
          return true;
        }
        for (let other = 0; other < customers.length; other += 1) {
          if (seenCustomer.has(other) || flow[other]![l]! <= 0) continue;
          seenCustomer.add(other);
          cameFromLot.set(other, l);
          queue.push(other);
        }
      }
    }
    return false;
  }

  let placed = 0;
  customers.forEach((share, c) => {
    for (let unit = 0; unit < share.quantity; unit += 1) {
      if (!augment(c)) break;
      placed += 1;
    }
  });

  const cells: Array<{ growerId: string; customerId: string; quantity: number }> = [];
  customers.forEach((share, c) => {
    lotList.forEach(({ lot }, l) => {
      const quantity = flow[c]![l]!;
      if (quantity > 0)
        cells.push({ growerId: lot.growerId, customerId: share.customerId, quantity });
    });
  });
  return { cells, placed };
}

/** Most pallets first, then grower id — the order lots are tried in, everywhere. */
function sortedLots(lots: readonly LotToFill[]): LotToFill[] {
  return [...lots].sort(
    (a, b) =>
      Math.floor(b.available) - Math.floor(a.available) || compareText(b.growerId, a.growerId),
  );
}

/**
 * The proposal for a day: one line per cell, in whole pallets.
 *
 * Works on what is still open. A customer is dealt only what they are still
 * owed (ordered, less what is already arranged to them), and only as much as
 * the lots they can still be given from hold: a lot where their cell is
 * already saved is not one of those, because a proposal never changes a
 * saved cell.
 */
export function proposeArrangement({
  day,
  learned,
  familyOf,
  customers,
}: {
  day: DayToPropose;
  learned: Learned;
  familyOf: Readonly<Record<string, string>>;
  customers: Readonly<Record<string, CustomerFacts>>;
}): ProposalLine[] {
  const lotsOf = new Map<string, DayToPropose["lots"]>();
  for (const lot of day.lots) listFor(lotsOf, lot.varietyId).push(lot);

  // Saved allocations: how much each customer has of each product, and which
  // cells (lot × customer) are taken.
  const arrangedTo = new Map<string, Map<string, number>>();
  const takenOn = new Map<string, Set<string>>();
  for (const cell of day.arranged) {
    // A saved cell is taken whatever it holds — the save refuses any cell
    // that has a record, zero pallets or not.
    setFor(takenOn, lotKey(cell.growerId, cell.varietyId)).add(cell.customerId);
    if (!(cell.quantity > 0)) continue;
    const byCustomer = mapFor(arrangedTo, cell.varietyId);
    byCustomer.set(cell.customerId, (byCustomer.get(cell.customerId) ?? 0) + cell.quantity);
  }

  // One order per customer per product — summed, at the earlier time, should
  // two ever arrive.
  const ordersOf = new Map<string, Map<string, { quantity: number; orderedAt: string }>>();
  for (const order of day.orders) {
    if (!(order.quantity > 0)) continue;
    const byCustomer = mapFor(ordersOf, order.varietyId);
    const earlier = byCustomer.get(order.customerId);
    byCustomer.set(order.customerId, {
      quantity: (earlier?.quantity ?? 0) + order.quantity,
      orderedAt:
        earlier && compareTimes(earlier.orderedAt, order.orderedAt) <= 0
          ? earlier.orderedAt
          : order.orderedAt,
    });
  }

  const lines: ProposalLine[] = [];
  for (const [varietyId, byCustomer] of ordersOf) {
    const family = familyOf[varietyId] ?? varietyId;
    const lots = (lotsOf.get(varietyId) ?? [])
      .filter((lot) => lot.available > 0)
      .map((lot) => ({
        growerId: lot.growerId,
        available: Math.floor(lot.available),
        takenBy: takenOn.get(lotKey(lot.growerId, varietyId)) ?? new Set<string>(),
      }));
    const supply = lots.reduce((sum, lot) => sum + lot.available, 0);
    if (supply <= 0) continue;

    const wanting: RankedOrder[] = [];
    for (const [customerId, order] of byCustomer) {
      const owed = Math.floor(order.quantity - (arrangedTo.get(varietyId)?.get(customerId) ?? 0));
      const reachable = lots
        .filter((lot) => !lot.takenBy.has(customerId))
        .reduce((sum, lot) => sum + lot.available, 0);
      const quantity = Math.min(owed, reachable);
      if (quantity <= 0) continue;
      wanting.push({
        customerId,
        quantity,
        orderedAt: order.orderedAt,
        rank: rankOf(customerId, varietyId, family),
      });
    }
    if (wanting.length === 0) continue;

    // Saved cells shut some customers out of some lots: then whether a set of
    // pallets per customer can be placed is a real question, asked exactly.
    // Otherwise any set within the stock can be, and dealInRounds' default
    // stands.
    const shutOut = lots.some((lot) => wanting.some((order) => lot.takenBy.has(order.customerId)));
    const dealt = shutOut
      ? dealInRounds(supply, wanting, (granted) => {
          const shares = Object.entries(granted).map(([customerId, quantity]) => ({
            customerId,
            quantity,
          }));
          const wantedNow = shares.reduce((sum, share) => sum + share.quantity, 0);
          return maximumPlacement(lots, shares).placed >= wantedNow;
        })
      : dealInRounds(supply, wanting);
    const shares = wanting
      .map((order) => ({ customerId: order.customerId, quantity: dealt[order.customerId] ?? 0 }))
      .filter((share) => share.quantity > 0);
    for (const cell of assignLots(lots, shares)) {
      lines.push({
        growerId: cell.growerId,
        varietyId,
        customerId: cell.customerId,
        quantity: cell.quantity,
      });
    }
  }
  return lines;

  function rankOf(customerId: string, varietyId: string, family: string): number[] {
    const outcomes = learned.shortages[customerId]?.[varietyId] ?? [];
    const points = outcomes.slice(-SHORTAGE_MEMORY).reduce((sum, outcome) => sum + outcome, 0);
    const received = learned.received[customerId]?.[varietyId] ?? 0;
    const facts = customers[customerId];
    const general = facts?.generalScore ?? UNRANKED_SCORE;
    // A newcomer has no habits to judge, so the general score stands in for them.
    const product = isNewcomer(facts?.since ?? null, day.date)
      ? general
      : productScore(learned.shares[customerId]?.[family] ?? 0);
    return [points, received, ownerPriority(general, product)];
  }
}

function isNewcomer(since: string | null, date: string): boolean {
  if (!since) return false;
  return (Date.parse(date) - Date.parse(since)) / DAY_MS < NEWCOMER_DAYS;
}

/** Plain code-point order, so the result is the same on every machine. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Earlier first; a time that cannot be read goes after every one that can. */
function compareTimes(a: string, b: string): number {
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first)) return Number.isNaN(second) ? 0 : 1;
  if (Number.isNaN(second)) return -1;
  return first - second;
}

/** Positive when `a` ranks above `b`, compared left to right. */
function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// Same separator, for the same reason, as matrix-data.ts.
const SEP = "\u0000";

function lotKey(growerId: string, varietyId: string): string {
  return `${growerId}${SEP}${varietyId}`;
}

function mapFor<K, V>(outer: Map<string, Map<K, V>>, key: string): Map<K, V> {
  let inner = outer.get(key);
  if (!inner) outer.set(key, (inner = new Map()));
  return inner;
}

function setFor<T>(outer: Map<string, Set<T>>, key: string): Set<T> {
  let inner = outer.get(key);
  if (!inner) outer.set(key, (inner = new Set()));
  return inner;
}

function listFor<T>(outer: Map<string, T[]>, key: string): T[] {
  let inner = outer.get(key);
  if (!inner) outer.set(key, (inner = []));
  return inner;
}
