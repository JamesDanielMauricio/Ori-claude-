// Pure derivation for the arrangement board — no React, no Supabase.
//
// The reference design reframes this screen around a PRODUCT: pick one
// variety and the four figures at the top (נקטף / הוזמן / חולק / נותר) and
// the emphasis in both columns all follow it. That is a different shape from
// the old two-lists-plus-a-table view, but it is the *same* data: one pass
// over the day's picks, orders and arrangement records produces all three
// projections below, so the screen still costs exactly one query.
//
// Kept out of the route component and free of dependencies so the arithmetic
// — which is what a distributor is trusting when they decide whether a
// customer's order is covered — can be read and tested on its own.

/** A variety as it arrives embedded on a pick or order line. */
export interface BoardVarietyRow {
  id: string;
  name: string;
  family_id: string;
  product_families: { name: string; image_url: string | null } | null;
}

export interface BoardPickLine {
  id: string;
  daily_pick_id: string;
  product_variety_id: string;
  pallets_picked: string;
  pickup_time: string | null;
  comment: string | null;
  product_varieties: BoardVarietyRow | null;
}

export interface BoardPick {
  id: string;
  grower_company_id: string;
  status: string;
  daily_pick_products: BoardPickLine[];
}

export interface BoardOrderLine {
  id: string;
  daily_order_id: string;
  product_variety_id: string;
  pallets_ordered: string;
  comment: string | null;
  product_varieties: BoardVarietyRow | null;
}

/** One `submit_order` call's full cart snapshot — see order_submission_logs. */
export interface BoardSubmissionLog {
  id: string;
  created_at: string;
  snapshot: Array<{ productVarietyId: string; palletsOrdered: number; comment: string | null }>;
}

export interface BoardOrder {
  id: string;
  customer_company_id: string;
  status: string;
  daily_order_products: BoardOrderLine[];
  /**
   * Newest first is NOT assumed — `buildBoard` sorts these itself — because
   * PostgREST doesn't order embedded rows for us and trusting the wire order
   * would silently break the moment that stopped being true.
   */
  order_submission_logs: BoardSubmissionLog[];
}

export interface BoardRecord {
  id: string;
  daily_pick_product_id: string;
  daily_order_product_id: string;
  customer_company_id: string;
  quantity_pallets: number;
  price: number | null;
  price_type: string | null;
}

export interface BoardCompany {
  id: string;
  name: string;
  default_pickup_time: string | null;
}

/** One selectable product — the unit the top strip and both columns key off. */
export interface BoardProduct {
  varietyId: string;
  varietyName: string;
  familyId: string;
  familyName: string;
  imageUrl: string | null;
  /** נקטף — total pallets picked across every grower. */
  picked: number;
  /** הוזמן — total pallets ordered across every customer. */
  ordered: number;
  /** חולק — total pallets already committed by arrangement records. */
  allocated: number;
  /** נותר — picked minus allocated: what is still free to arrange. */
  remaining: number;
  /**
   * The PRD's OOS flag: demand exceeds supply for this variety. Note it
   * compares against `picked`, not `remaining` — a variety whose whole
   * supply is already allocated is fully committed, not oversold.
   */
  outOfStock: boolean;
}

export interface GrowerPickLine {
  pickLineId: string;
  varietyId: string;
  varietyName: string;
  picked: number;
  allocated: number;
  /** What this grower still has free on this line. */
  remaining: number;
  pickupTime: string | null;
  comment: string | null;
}

export interface GrowerFamilyGroup {
  familyId: string;
  familyName: string;
  imageUrl: string | null;
  lines: GrowerPickLine[];
}

export interface GrowerSupply {
  growerId: string;
  growerName: string;
  /**
   * The `daily_picks` row id, carried so the board's pencil can open that
   * pick's line editor in place. `growerId` is a company and cannot address
   * one day's submission.
   */
  pickId: string;
  status: string;
  /**
   * The grower's collection time for the day: the earliest per-line override
   * if any line sets one, else the company default. Null when neither
   * exists, in which case the row shows no time rather than inventing one.
   */
  pickupTime: string | null;
  picked: number;
  allocated: number;
  families: GrowerFamilyGroup[];
  /** True when any of this grower's lines carries the selected variety. */
  hasSelected: boolean;
}

export interface LineAllocation {
  recordId: string;
  pickLineId: string;
  growerId: string;
  growerName: string;
  quantity: number;
  /**
   * Carried through so an inline quantity edit can send them back unchanged.
   * update_arrangement_record overwrites all three columns unconditionally
   * (migration 0021), so a quantity-only edit that omitted these would blank
   * the price on an already-priced record.
   */
  price: number | null;
  priceType: string | null;
}

export interface CustomerOrderLine {
  orderLineId: string;
  varietyId: string;
  varietyName: string;
  familyName: string;
  ordered: number;
  /**
   * What this line was ordered at as of the customer's PREVIOUS submission —
   * i.e. before their latest change — from order_submission_logs. Null when
   * there is no earlier submission to compare against, or when there is one
   * but it named the same quantity: either way there is nothing to flag.
   */
  previousOrdered: number | null;
  allocated: number;
  /** Still owed to this customer on this line. */
  outstanding: number;
  comment: string | null;
  allocations: LineAllocation[];
}

export interface CustomerDemand {
  customerId: string;
  customerName: string;
  status: string;
  ordered: number;
  allocated: number;
  lines: CustomerOrderLine[];
  hasSelected: boolean;
}

export interface Board {
  products: BoardProduct[];
  growers: GrowerSupply[];
  customers: CustomerDemand[];
}

// PostgREST hands numerics back as bare JSON numbers on some columns and as
// strings on others depending on how each was declared; every read here goes
// through this rather than trusting either. A missing or unparseable value
// becomes 0 — on a board whose whole job is totalling pallets, a NaN
// propagating into a column heading is worse than treating an absent line as
// contributing nothing.
export function parsePallets(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Local alias so the many call sites below stay terse. Exported under the
// fuller name because the arrangement matrix (matrix-data.ts) reads the same
// wire rows and must apply the identical coercion — two different rules for
// "what is a missing pallet count" across two views of one day is exactly the
// disagreement this function exists to prevent.
const num = parsePallets;

// "12:00:00" -> "12:00". Postgres `time` columns arrive with seconds that
// nobody sets and nobody reads.
export function formatPickupTime(time: string | null): string | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return match ? `${match[1]}:${match[2]}` : time;
}

const PALLET_FORMAT = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

/** Pallet counts are frequently halves (5.5), so this trims 5.0 back to "5". */
export function formatPallets(value: number): string {
  return PALLET_FORMAT.format(value);
}

export function buildBoard({
  picks,
  orders,
  records,
  companies,
}: {
  picks: BoardPick[];
  orders: BoardOrder[];
  records: BoardRecord[];
  companies: BoardCompany[];
}): Board {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const nameOf = (id: string) => companyById.get(id)?.name ?? id;

  // ---- indexes over the raw rows --------------------------------------
  const pickLines = picks.flatMap((pick) => pick.daily_pick_products);
  const orderLines = orders.flatMap((order) => order.daily_order_products);

  const pickLineById = new Map(pickLines.map((line) => [line.id, line]));
  const growerIdByPickId = new Map(picks.map((pick) => [pick.id, pick.grower_company_id]));

  // Allocation totals, accumulated in one pass and read by all three
  // projections below.
  const allocatedByPickLine = new Map<string, number>();
  const allocatedByOrderLine = new Map<string, number>();
  const allocatedByVariety = new Map<string, number>();
  const recordsByOrderLine = new Map<string, LineAllocation[]>();

  for (const record of records) {
    const quantity = num(record.quantity_pallets);
    const pickLine = pickLineById.get(record.daily_pick_product_id);

    allocatedByPickLine.set(
      record.daily_pick_product_id,
      (allocatedByPickLine.get(record.daily_pick_product_id) ?? 0) + quantity,
    );
    allocatedByOrderLine.set(
      record.daily_order_product_id,
      (allocatedByOrderLine.get(record.daily_order_product_id) ?? 0) + quantity,
    );

    // A record whose pick line didn't come back still counts against the
    // order line above — the customer is owed it either way — but there is
    // no variety or grower to attribute it to, so it is skipped here rather
    // than bucketed under a placeholder that would read as a real grower.
    if (!pickLine) continue;

    allocatedByVariety.set(
      pickLine.product_variety_id,
      (allocatedByVariety.get(pickLine.product_variety_id) ?? 0) + quantity,
    );

    const growerId = growerIdByPickId.get(pickLine.daily_pick_id);
    const list = recordsByOrderLine.get(record.daily_order_product_id) ?? [];
    list.push({
      recordId: record.id,
      pickLineId: pickLine.id,
      growerId: growerId ?? "",
      growerName: growerId ? nameOf(growerId) : "—",
      quantity,
      price: record.price === null ? null : num(record.price),
      priceType: record.price_type,
    });
    recordsByOrderLine.set(record.daily_order_product_id, list);
  }

  // ---- products (the top strip) ----------------------------------------
  const productAcc = new Map<
    string,
    { variety: BoardVarietyRow; picked: number; ordered: number }
  >();

  const touch = (variety: BoardVarietyRow | null) => {
    if (!variety) return null;
    let entry = productAcc.get(variety.id);
    if (!entry) {
      entry = { variety, picked: 0, ordered: 0 };
      productAcc.set(variety.id, entry);
    }
    return entry;
  };

  for (const line of pickLines) {
    const entry = touch(line.product_varieties);
    if (entry) entry.picked += num(line.pallets_picked);
  }
  for (const line of orderLines) {
    const entry = touch(line.product_varieties);
    if (entry) entry.ordered += num(line.pallets_ordered);
  }

  const products: BoardProduct[] = [...productAcc.values()]
    .map(({ variety, picked, ordered }) => {
      const allocated = allocatedByVariety.get(variety.id) ?? 0;
      return {
        varietyId: variety.id,
        varietyName: variety.name,
        familyId: variety.family_id,
        familyName: variety.product_families?.name ?? "",
        imageUrl: variety.product_families?.image_url ?? null,
        picked,
        ordered,
        allocated,
        remaining: picked - allocated,
        outOfStock: ordered > picked,
      };
    })
    // Family first, then variety — so the picker reads as a catalog rather
    // than as an alphabetical jumble of variety names whose families are
    // scattered through it.
    .sort(
      (a, b) =>
        a.familyName.localeCompare(b.familyName, "he") ||
        a.varietyName.localeCompare(b.varietyName, "he"),
    );

  // ---- growers column ---------------------------------------------------
  const growers: GrowerSupply[] = picks
    .map((pick) => {
      const families = new Map<string, GrowerFamilyGroup>();
      let picked = 0;
      let allocated = 0;
      const pickupTimes: string[] = [];

      for (const line of pick.daily_pick_products) {
        const variety = line.product_varieties;
        if (!variety) continue;
        const linePicked = num(line.pallets_picked);
        const lineAllocated = allocatedByPickLine.get(line.id) ?? 0;
        picked += linePicked;
        allocated += lineAllocated;
        if (line.pickup_time) pickupTimes.push(line.pickup_time);

        let group = families.get(variety.family_id);
        if (!group) {
          group = {
            familyId: variety.family_id,
            familyName: variety.product_families?.name ?? "",
            imageUrl: variety.product_families?.image_url ?? null,
            lines: [],
          };
          families.set(variety.family_id, group);
        }
        group.lines.push({
          pickLineId: line.id,
          varietyId: variety.id,
          varietyName: variety.name,
          picked: linePicked,
          allocated: lineAllocated,
          remaining: linePicked - lineAllocated,
          pickupTime: line.pickup_time,
          comment: line.comment,
        });
      }

      for (const group of families.values()) {
        group.lines.sort((a, b) => a.varietyName.localeCompare(b.varietyName, "he"));
      }

      // `time` values are zero-padded "HH:MM:SS", so a plain string compare
      // is a correct chronological one — no Date parsing needed to find the
      // earliest of them.
      const earliest = pickupTimes.reduce<string | null>(
        (min, time) => (min === null || time < min ? time : min),
        null,
      );

      return {
        growerId: pick.grower_company_id,
        growerName: nameOf(pick.grower_company_id),
        pickId: pick.id,
        status: pick.status,
        pickupTime:
          earliest ?? companyById.get(pick.grower_company_id)?.default_pickup_time ?? null,
        picked,
        allocated,
        families: [...families.values()].sort((a, b) =>
          a.familyName.localeCompare(b.familyName, "he"),
        ),
        hasSelected: false,
      };
    })
    // Bootstrapped picks with nothing entered yet would otherwise fill the
    // column with empty rows. Who was *asked* for produce is the Shop
    // screen's subject; this column is about who actually has some.
    .filter((grower) => grower.families.length > 0)
    // By collection time, because that is the order the day physically
    // happens in — a grower collected at 12:00 is loaded before one at
    // 16:00. Rows with no time sort last rather than to the top.
    .sort(
      (a, b) =>
        (a.pickupTime ?? "99").localeCompare(b.pickupTime ?? "99") ||
        a.growerName.localeCompare(b.growerName, "he"),
    );

  // ---- customers column -------------------------------------------------
  const customers: CustomerDemand[] = orders
    .map((order) => {
      let ordered = 0;
      let allocated = 0;
      const lines: CustomerOrderLine[] = [];

      // The submission immediately before the one that produced today's live
      // daily_order_products rows — newest first, so index 1 is "one edit
      // ago." Index 0 (the latest log) is deliberately unused: the live
      // pallets_ordered column above is already that same value, read
      // straight from the table submit_order just wrote instead of assumed
      // to match a log row.
      const previousSnapshot = [...order.order_submission_logs].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[1]?.snapshot;
      const previousOrderedByVariety = new Map(
        (previousSnapshot ?? []).map((line) => [line.productVarietyId, num(line.palletsOrdered)]),
      );

      for (const line of order.daily_order_products) {
        const variety = line.product_varieties;
        if (!variety) continue;
        const lineOrdered = num(line.pallets_ordered);
        const lineAllocated = allocatedByOrderLine.get(line.id) ?? 0;
        ordered += lineOrdered;
        allocated += lineAllocated;
        // Absent from the previous submission reads as 0 pallets — the same
        // "not included means not ordered" rule submit_order itself applies
        // when pruning — rather than as "no history," which is reserved for
        // a customer who has never submitted more than once.
        const previousLineOrdered = previousSnapshot
          ? (previousOrderedByVariety.get(variety.id) ?? 0)
          : null;
        lines.push({
          orderLineId: line.id,
          varietyId: variety.id,
          varietyName: variety.name,
          familyName: variety.product_families?.name ?? "",
          ordered: lineOrdered,
          previousOrdered:
            previousLineOrdered !== null && previousLineOrdered !== lineOrdered
              ? previousLineOrdered
              : null,
          allocated: lineAllocated,
          outstanding: lineOrdered - lineAllocated,
          comment: line.comment,
          allocations: (recordsByOrderLine.get(line.id) ?? []).sort((a, b) =>
            a.growerName.localeCompare(b.growerName, "he"),
          ),
        });
      }

      lines.sort(
        (a, b) =>
          a.familyName.localeCompare(b.familyName, "he") ||
          a.varietyName.localeCompare(b.varietyName, "he"),
      );

      return {
        customerId: order.customer_company_id,
        customerName: nameOf(order.customer_company_id),
        status: order.status,
        ordered,
        allocated,
        lines,
        hasSelected: false,
      };
    })
    // Every customer with an order header for the day is kept, including
    // those who ordered nothing at all. They used to be filtered out as
    // empty noise, which quietly made them unreachable: the board's lower
    // section exists to offer surplus to people who did not order the
    // selected product, and someone who ordered nothing is the clearest case
    // of that. `splitCustomersByVariety` is where they are hidden again while
    // no product is selected.
    //
    // Customers still owed produce come first: they are the ones the
    // distributor still has work to do on. Within each group, by name.
    .sort(
      (a, b) =>
        Number(b.ordered - b.allocated > 0) - Number(a.ordered - a.allocated > 0) ||
        a.customerName.localeCompare(b.customerName, "he"),
    );

  return { products, growers, customers };
}

/**
 * Marks which grower/customer cards touch the selected variety.
 *
 * Split out of `buildBoard` on purpose: selecting a different product must
 * not re-derive every total on the board. The expensive pass above depends
 * only on the query result, so it memoizes on that; this cheap pass is the
 * only thing that re-runs when the distributor clicks another product.
 */
export function markSelected(board: Board, varietyId: string | null): Board {
  if (!varietyId) return board;
  return {
    products: board.products,
    growers: board.growers.map((grower) => ({
      ...grower,
      hasSelected: grower.families.some((family) =>
        family.lines.some((line) => line.varietyId === varietyId),
      ),
    })),
    customers: board.customers.map((customer) => ({
      ...customer,
      hasSelected: customer.lines.some((line) => line.varietyId === varietyId),
    })),
  };
}

/** One arrangement record, flattened for the records table below the board. */
export interface FlatRecord {
  recordId: string;
  varietyLabel: string;
  growerName: string;
  customerName: string;
  quantity: number;
  price: number | null;
  priceType: string | null;
}

/**
 * The records table's rows, read back off the customer projection rather
 * than re-joined from the raw records.
 *
 * Every field the table shows is already resolved there — the variety it is
 * against, the grower it came from, the customer it is for — so deriving it
 * a second time from `arrangement_records` would be a second chance for the
 * two views of the same record to disagree.
 */
export function flattenRecords(customers: CustomerDemand[]): FlatRecord[] {
  const rows: FlatRecord[] = [];
  for (const customer of customers) {
    for (const line of customer.lines) {
      for (const allocation of line.allocations) {
        rows.push({
          recordId: allocation.recordId,
          varietyLabel: line.familyName
            ? `${line.familyName} — ${line.varietyName}`
            : line.varietyName,
          growerName: allocation.growerName,
          customerName: customer.customerName,
          quantity: allocation.quantity,
          price: allocation.price,
          priceType: allocation.priceType,
        });
      }
    }
  }
  return rows;
}

/** The grower pick line the distributor is currently allocating from. */
export interface PickSelection {
  pickLineId: string;
  varietyId: string;
  growerId: string;
}

export interface SelectedPickLine {
  grower: GrowerSupply;
  line: GrowerPickLine;
  family: GrowerFamilyGroup;
}

/**
 * Resolves a selection back to the live board.
 *
 * Returns null when the pick line is no longer there — the grower deleted
 * the line, or the day moved on — which is what lets the screen fall back to
 * "nothing selected" instead of holding a reference to a row that has gone.
 */
export function findPickLine(board: Board, pickLineId: string | null): SelectedPickLine | null {
  if (!pickLineId) return null;
  for (const grower of board.growers) {
    for (const family of grower.families) {
      for (const line of family.lines) {
        if (line.pickLineId === pickLineId) return { grower, line, family };
      }
    }
  }
  return null;
}

/** The arrangement record pairing one order line with one grower pick line. */
export function allocationFor(
  line: CustomerOrderLine,
  pickLineId: string | null,
): LineAllocation | null {
  if (!pickLineId) return null;
  return line.allocations.find((a) => a.pickLineId === pickLineId) ?? null;
}

export interface CustomerSplit {
  /** Above the dashed rule: customers with a line for the selected variety. */
  ordering: CustomerDemand[];
  /** Below it: everyone else trading today. */
  other: CustomerDemand[];
}

/**
 * The board's two-section customer list.
 *
 * The split is the reference design's dashed separator, and it is what makes
 * the screen a working surface rather than a report: with one grower's
 * product selected, the top group is "who asked for this" — the allocations
 * to settle right now — and the bottom is "who else is here today", the
 * people surplus can be pushed to.
 *
 * `promoted` holds customers the distributor has moved up with the + button
 * but not yet saved an allocation for. They deliberately have no order line
 * in the database yet (nothing is written until ✓), so this set is the only
 * thing that knows about them, and it is why membership of the top group
 * cannot simply be derived from the query result.
 */
export function splitCustomersByVariety(
  customers: CustomerDemand[],
  varietyId: string | null,
  promoted: ReadonlySet<string>,
): CustomerSplit {
  // With nothing selected there is no second group to be in, and a customer
  // who ordered nothing has nothing to show — so the undivided list is the
  // people who actually placed an order. They come back the moment a product
  // is selected and the lower half acquires a purpose.
  if (!varietyId) {
    return { ordering: customers.filter((customer) => customer.lines.length > 0), other: [] };
  }
  const ordering: CustomerDemand[] = [];
  const other: CustomerDemand[] = [];
  for (const customer of customers) {
    const hasLine = customer.lines.some((line) => line.varietyId === varietyId);
    if (hasLine || promoted.has(customer.customerId)) ordering.push(customer);
    else other.push(customer);
  }
  return { ordering, other };
}
