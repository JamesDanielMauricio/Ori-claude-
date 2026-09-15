// Pure derivation for the arrangement MATRIX — no React, no Supabase.
//
// The matrix is the source app's "סידור לפי מוצרים" screen: one row per
// product, one column per customer, and a cell wherever the two meet. It is
// the same day's data as the arrangement board next door (board-data.ts) —
// the same picks, orders and arrangement records, out of the same single
// query — projected a different way. The board asks "who gets this grower's
// pallets?"; the matrix asks "where did every product go?", and lets the
// distributor answer that for the whole day without selecting anything
// first.
//
// Two row shapes, and the distinction is the screen's central idea:
//
//   PRODUCT row — one variety. Its cells are read-only sums, because a
//                 pallet has to come off a NAMED grower's lot: an
//                 arrangement record points at a daily_pick_products row, so
//                 "3 pallets of lemons to Gabbai" is not by itself a
//                 writable fact once two growers have picked lemons.
//   GROWER row  — one pick line under that product, revealed by expanding.
//                 These carry the editable cells.
//
// When only ONE grower picked a variety there is no ambiguity to resolve, so
// the product row carries that grower's editable cells directly and does not
// expand at all. That is why `expandable` is a property of the data rather
// than a UI preference — it follows from how many lots exist.
//
// Kept free of React and of the network so the arithmetic — which is what a
// distributor is trusting when they decide a customer is covered — can be
// read and tested on its own, exactly as board-data.ts is.
import {
  parsePallets,
  type BoardCompany,
  type BoardOrder,
  type BoardPick,
  type BoardRecord,
} from "./board-data";

/** One customer column. */
export interface MatrixColumn {
  customerId: string;
  customerName: string;
}

/** One row's figures for one customer. */
export interface MatrixCell {
  /**
   * Pallets this customer ordered of the row's VARIETY — the number printed
   * above the box, and the thing that makes a cell worth looking at.
   *
   * Carried on grower rows too, even though they never print it: the "this
   * customer wants this product" highlight has to run down the expanded
   * grower rows as well, and re-deriving it there from the parent row would
   * be a second chance for the highlight and the number to disagree.
   */
  ordered: number;
  /** Pallets already arranged to this customer out of this row's supply. */
  allocated: number;
  /**
   * The arrangement record behind `allocated`, when this row addresses
   * exactly one pick line. Null on a multi-grower product row (whose sum
   * spans several records) and on any cell with nothing arranged yet.
   */
  recordId: string | null;
  /**
   * Carried so a quantity-only write can hand them back untouched.
   * arrange_to_customer COALESCEs both onto the existing row (migration
   * 0040), so sending null would be read as "leave them alone" — but we send
   * what is actually there rather than relying on that.
   */
  price: number | null;
  priceType: string | null;
}

export interface MatrixGrowerRow {
  kind: "grower";
  /** Stable identity for React keys and for the focused-cell address. */
  key: string;
  /** The variety this row sits under — its parent product row's id. */
  varietyId: string;
  pickLineId: string;
  growerId: string;
  growerName: string;
  /** סה"כ במלאי — pallets_picked on this one line. */
  inStock: number;
  /** Leftover carried into today on this line — see BoardPickLine.leftover_pallets. */
  leftover: number;
  /** סה"כ חולק — arranged off this line, to anyone. */
  allocated: number;
  /** זמין — (inStock + leftover) minus allocated: what is still free to give away from this line. */
  available: number;
  cells: MatrixCell[];
}

export interface MatrixProductRow {
  kind: "product";
  key: string;
  varietyId: string;
  varietyName: string;
  familyName: string;
  /** סה"כ במלאי — summed across every grower who picked this variety. */
  inStock: number;
  /** Leftover carried into today, summed across every grower who has this variety. */
  leftover: number;
  /** סה"כ הוזמן — summed across every customer column. */
  ordered: number;
  /** סה"כ חולק — summed across this row's growers. */
  allocated: number;
  /** זמין — (inStock + leftover) minus allocated. */
  available: number;
  /**
   * Two or more growers picked this variety, so the row opens rather than
   * being typed into. See the header comment: with one lot there is nothing
   * to disambiguate, so the row IS the grower row.
   */
  expandable: boolean;
  growers: MatrixGrowerRow[];
  cells: MatrixCell[];
}

export type MatrixRow = MatrixProductRow | MatrixGrowerRow;

export interface Matrix {
  columns: MatrixColumn[];
  rows: MatrixProductRow[];
}

// The two halves of a composite map key. A NUL separator rather than ":"
// because both halves are UUIDs today but the variety half is only ever
// going to be as safe as whatever produces it — a separator that cannot
// occur in either half costs nothing and removes the question.
const SEP = "\u0000";

function emptyCells(width: number): MatrixCell[] {
  return Array.from({ length: width }, () => ({
    ordered: 0,
    allocated: 0,
    recordId: null,
    price: null,
    priceType: null,
  }));
}

export function buildMatrix({
  picks,
  orders,
  records,
  companies,
}: {
  picks: BoardPick[];
  orders: BoardOrder[];
  records: BoardRecord[];
  companies: BoardCompany[];
}): Matrix {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const nameOf = (id: string) => companyById.get(id)?.name ?? id;

  // ---- columns ----------------------------------------------------------
  // Every customer with an order HEADER for the day, not only those who
  // ordered something. open_shop bootstraps one header per active customer,
  // and a header is precisely what arrange_to_customer requires to exist (it
  // raises P0002 without one) — so this list is exactly the set of people a
  // cell can be written for. A customer who ordered nothing is a column of
  // zeroes, which is the honest picture: they are trading today, and surplus
  // can still be pushed to them.
  const columns: MatrixColumn[] = orders
    .map((order) => ({
      customerId: order.customer_company_id,
      customerName: nameOf(order.customer_company_id),
    }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName, "he"));

  const columnIndex = new Map(columns.map((column, index) => [column.customerId, index]));

  // ---- indexes over the raw rows ----------------------------------------
  const growerIdByPickId = new Map(picks.map((pick) => [pick.id, pick.grower_company_id]));

  // An order line resolves to (customer, variety). This is the authoritative
  // join for a record's customer — arrangement_records.customer_company_id
  // is a denormalised copy of the same fact, used only as the fallback below.
  const orderLineOwner = new Map<string, string>();
  // Ordered pallets per variety per customer: the number above every
  // product-row box.
  const orderedByVarietyCustomer = new Map<string, number>();

  for (const order of orders) {
    for (const line of order.daily_order_products) {
      orderLineOwner.set(line.id, order.customer_company_id);
      const varietyId = line.product_varieties?.id ?? line.product_variety_id;
      const key = `${varietyId}${SEP}${order.customer_company_id}`;
      orderedByVarietyCustomer.set(
        key,
        (orderedByVarietyCustomer.get(key) ?? 0) + parsePallets(line.pallets_ordered),
      );
    }
  }

  // What each pick line has committed, and to whom.
  //
  // The per-line TOTAL is accumulated from every record, while the per-cell
  // entry is written only when the record's customer resolves to a column.
  // Deliberately not one pass: a record whose order line didn't come back
  // still consumed the grower's pallets, so dropping it from the total would
  // show supply as free when it is not — and זמין is the one number on this
  // screen that must never read high.
  const allocatedByPickLine = new Map<string, number>();
  const cellByPickLineCustomer = new Map<
    string,
    { allocated: number; recordId: string; price: number | null; priceType: string | null }
  >();

  for (const record of records) {
    const quantity = parsePallets(record.quantity_pallets);
    allocatedByPickLine.set(
      record.daily_pick_product_id,
      (allocatedByPickLine.get(record.daily_pick_product_id) ?? 0) + quantity,
    );

    const customerId =
      orderLineOwner.get(record.daily_order_product_id) ?? record.customer_company_id;
    if (!customerId || !columnIndex.has(customerId)) continue;

    // One record per (pick line, customer): an order line is unique per
    // (order, variety) and an order is unique per (day, customer), so this
    // pair cannot legitimately collide. Summing rather than assigning means
    // that if one ever did, it would surface as a too-large number the
    // server then refuses, instead of silently hiding one of the two.
    const key = `${record.daily_pick_product_id}${SEP}${customerId}`;
    const existing = cellByPickLineCustomer.get(key);
    cellByPickLineCustomer.set(key, {
      allocated: (existing?.allocated ?? 0) + quantity,
      recordId: record.id,
      price: record.price === null ? null : parsePallets(record.price),
      priceType: record.price_type,
    });
  }

  // ---- rows -------------------------------------------------------------
  // Grouped by variety across ALL growers, which is the point of the screen:
  // two growers' lemons are one row of the distributor's stock, and only
  // become two rows when the row is opened.
  interface Accumulator {
    varietyName: string;
    familyName: string;
    growers: MatrixGrowerRow[];
  }
  const byVariety = new Map<string, Accumulator>();

  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      const variety = line.product_varieties;
      // A line whose variety didn't come back has no row to belong to and
      // nothing to label it with. Skipped rather than bucketed under a
      // placeholder, the same way board-data.ts drops orphaned records.
      if (!variety) continue;

      let entry = byVariety.get(variety.id);
      if (!entry) {
        entry = {
          varietyName: variety.name,
          familyName: variety.product_families?.name ?? "",
          growers: [],
        };
        byVariety.set(variety.id, entry);
      }

      const inStock = parsePallets(line.pallets_picked);
      const leftover = parsePallets(line.leftover_pallets);
      const allocated = allocatedByPickLine.get(line.id) ?? 0;
      const growerId = growerIdByPickId.get(line.daily_pick_id) ?? "";
      const cells = emptyCells(columns.length);

      for (const [customerId, index] of columnIndex) {
        const allocation = cellByPickLineCustomer.get(`${line.id}${SEP}${customerId}`);
        cells[index] = {
          ordered: orderedByVarietyCustomer.get(`${variety.id}${SEP}${customerId}`) ?? 0,
          allocated: allocation?.allocated ?? 0,
          recordId: allocation?.recordId ?? null,
          price: allocation?.price ?? null,
          priceType: allocation?.priceType ?? null,
        };
      }

      entry.growers.push({
        kind: "grower",
        key: line.id,
        varietyId: variety.id,
        pickLineId: line.id,
        growerId,
        growerName: growerId ? nameOf(growerId) : "—",
        inStock,
        leftover,
        allocated,
        available: inStock + leftover - allocated,
        cells,
      });
    }
  }

  const rows: MatrixProductRow[] = [...byVariety.entries()]
    .map(([varietyId, entry]) => {
      const growers = entry.growers.sort((a, b) => a.growerName.localeCompare(b.growerName, "he"));

      const summed = emptyCells(columns.length);
      for (const [customerId, index] of columnIndex) {
        // The product row's own cell: the customer's request (a fact about
        // the variety, identical on every grower row beneath it) over the
        // sum of what those growers have committed to them. No recordId —
        // the sum may span several records, which is exactly why it is
        // read-only.
        summed[index] = {
          ordered: orderedByVarietyCustomer.get(`${varietyId}${SEP}${customerId}`) ?? 0,
          allocated: growers.reduce((sum, grower) => sum + (grower.cells[index]?.allocated ?? 0), 0),
          recordId: null,
          price: null,
          priceType: null,
        };
      }

      const inStock = growers.reduce((sum, grower) => sum + grower.inStock, 0);
      const leftover = growers.reduce((sum, grower) => sum + grower.leftover, 0);
      const allocated = growers.reduce((sum, grower) => sum + grower.allocated, 0);
      // Present only when this variety came from exactly one lot — the case
      // where the product row and the grower row are the same row.
      const soleGrower = growers.length === 1 ? growers[0] : undefined;

      return {
        kind: "product" as const,
        key: varietyId,
        varietyId,
        varietyName: entry.varietyName,
        familyName: entry.familyName,
        inStock,
        leftover,
        ordered: summed.reduce((sum, cell) => sum + cell.ordered, 0),
        allocated,
        available: inStock + leftover - allocated,
        expandable: growers.length > 1,
        growers,
        // With one lot the product row IS the grower row, so it takes that
        // grower's cells verbatim — recordId, price and all — and becomes
        // directly writable. This is the one place the two row shapes merge,
        // and it is why there is no expand control on a row that would only
        // ever reveal a copy of itself.
        cells: soleGrower ? soleGrower.cells : summed,
      };
    })
    // Family first, then variety — the same catalog order the board's
    // product strip uses, so the two screens list the day's stock the same
    // way instead of each in an order of its own.
    .sort(
      (a, b) =>
        a.familyName.localeCompare(b.familyName, "he") ||
        a.varietyName.localeCompare(b.varietyName, "he"),
    );

  return { columns, rows };
}

/**
 * The header's product search.
 *
 * Matches family or variety name, because a distributor hunting for "לימון"
 * is as likely to be thinking of the family as of the exact variety name
 * they would otherwise have to spell. An empty query is the whole list
 * rather than nothing.
 */
export function filterMatrixRows(rows: MatrixProductRow[], query: string): MatrixProductRow[] {
  const needle = query.trim().toLocaleLowerCase("he");
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.varietyName.toLocaleLowerCase("he").includes(needle) ||
      row.familyName.toLocaleLowerCase("he").includes(needle),
  );
}

/**
 * Products flattened into the rows actually painted, each expanded product
 * followed by its growers.
 *
 * Kept here rather than inline in the component because the matrix is
 * virtualised: the renderer needs a flat, index-addressable list whose
 * length it can multiply by a row height — and "which index is which row" is
 * then also what keyboard navigation moves through.
 */
export function flattenMatrixRows(
  rows: MatrixProductRow[],
  expanded: ReadonlySet<string>,
): MatrixRow[] {
  const flat: MatrixRow[] = [];
  for (const row of rows) {
    flat.push(row);
    if (row.expandable && expanded.has(row.varietyId)) flat.push(...row.growers);
  }
  return flat;
}

/** The one cell a write is addressed to. Null when the cell is read-only. */
export interface CellTarget {
  pickLineId: string;
  customerId: string;
  recordId: string | null;
  price: number | null;
  priceType: string | null;
  /** What the server currently holds, so an unchanged edit can be skipped. */
  current: number;
}

/**
 * Parses a cell's typed value into the quantity a write would carry, or
 * `null` when the text isn't a valid one to commit — shared by both grid
 * presentations (the desktop spreadsheet and the mobile card list) so a
 * quantity is accepted or rejected by the same rule wherever it's typed.
 *
 * A decimal comma is what a Hebrew keyboard produces on the numpad, and
 * half-pallets (5.5) are routine — so both separators are accepted. An empty
 * box means "nothing is arranged here", which is a deletion (quantity 0),
 * not a no-op or an invalid entry.
 */
export function parseMatrixQuantity(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Resolves "row × column" to the pick line a write lands on.
 *
 * Returns null for a multi-grower product row — the read-only sum. The whole
 * editability of the grid hangs off this one rule, so it lives in a single
 * tested function rather than being re-decided at each call site.
 */
export function cellTarget(
  row: MatrixRow,
  columnIndex: number,
  columns: MatrixColumn[],
): CellTarget | null {
  const column = columns[columnIndex];
  const cell = row.cells[columnIndex];
  if (!column || !cell) return null;

  const pickLineId =
    row.kind === "grower"
      ? row.pickLineId
      : row.expandable
        ? null
        : (row.growers[0]?.pickLineId ?? null);
  if (!pickLineId) return null;

  return {
    pickLineId,
    customerId: column.customerId,
    recordId: cell.recordId,
    price: cell.price,
    priceType: cell.priceType,
    current: cell.allocated,
  };
}
