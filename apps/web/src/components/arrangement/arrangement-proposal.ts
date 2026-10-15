// A PROPOSED arrangement, before it is saved — no React, no Supabase.
//
// "הצע סידור" fills the matrix with a suggestion for the whole day. Nothing
// is written when it appears: the distributor reads it in the grid, corrects
// what they disagree with, and then saves it — or throws it away — as one
// decision. This file is the part of that which can be read and tested on its
// own: turning a suggestion into the cells it lands in, changing one of those
// cells, and saying which cells a refused save named.
//
// Where a suggestion COMES from is deliberately not this file's business. It
// arrives as `ProposalLine`s — whose lot, which product, which customer, how
// many pallets — and everything here treats it the same whoever produced it
// (today, arrangement-engine.ts). Saving is one database function,
// save_arrangement_proposal (migration 0068): all or nothing, and only into
// cells still empty.
import { ARRANGEMENT_ERROR_CODES } from "@ori/domain/arrangement";

import { formatVarietyName } from "@/lib/variety-label";

import type { BoardOrder, BoardPick, BoardRecord } from "./board-data";
import type { ProposedAllocation } from "./matrix-data";

/** One line of a suggestion, in the day's own terms rather than in row ids. */
export interface ProposalLine {
  growerId: string;
  varietyId: string;
  customerId: string;
  quantity: number;
  /**
   * Whether the line is meant to fill the customer's order — and whose number
   * it is:
   *
   *   suggested  worked out by the engine, which only ever fills an order.
   *   typed      typed by the distributor for a customer who, on the day as
   *              read at that moment, had ordered that product.
   *
   * A line for an order is held to it each time the day is read again (see
   * resolveProposal): dropped once the order is withdrawn, and a suggestion
   * cut to what is left of the order once the numbers typed have taken
   * theirs. A typed number is never cut.
   *
   * A line without it is a push — a number typed for a customer with no order
   * for the product — and is left as typed. Saving tells the database which
   * cells were for an order (`forOrder`), so it can refuse one whose order
   * went in the moments before the save rather than save it as a push.
   */
  forOrder?: "suggested" | "typed";
}

export interface ResolvedProposal {
  /** What is still to be saved: one entry per cell. */
  allocations: ProposedAllocation[];
  /** Lines left out because their cell already holds a saved allocation. */
  alreadyArranged: number;
  /**
   * Lines left out because the day has nowhere to put them: that grower has
   * no lot of that product, that customer is not trading, or the quantity is
   * not a whole number of pallets above zero.
   */
  unplaceable: number;
  /**
   * Lines dropped or cut so as not to go over what the customer has on order:
   * lines for an order that has since been withdrawn, and suggestions cut
   * because less of it is left than they proposed — reduced, arranged
   * elsewhere, or taken by numbers the distributor typed.
   */
  heldToOrder: number;
}

// Same separator, for the same reason, as matrix-data.ts.
const SEP = "\u0000";

/**
 * Pallets each customer has on order of each product, keyed customer and
 * product — order lines above zero only, as the grid and the save count an
 * order. A line for no pallets (a push leaves one behind) is no order.
 */
function orderedPallets(orders: readonly BoardOrder[]): Map<string, number> {
  const ordered = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.daily_order_products) {
      const pallets = Number(line.pallets_ordered);
      if (!(pallets > 0)) continue;
      const key = `${order.customer_company_id}${SEP}${line.product_varieties?.id ?? line.product_variety_id}`;
      ordered.set(key, (ordered.get(key) ?? 0) + pallets);
    }
  }
  return ordered;
}

/**
 * Lands a suggestion on the day as it was last read.
 *
 * A cell that already has an allocation saved in it is never suggested over:
 * that number is a decision somebody made, and a suggestion has no business
 * replacing it. The same rule is what lets the screen re-resolve a proposal
 * against every new read of the day — a cell drops out once its record is
 * there, so nothing is shown, or offered for saving, twice.
 *
 * That is a promise about the PREVIEW, and only as fresh as the read behind
 * it. The save keeps it for real: save_arrangement_proposal refuses, rather
 * than overwrites, a cell filled since the read.
 *
 * Supply and demand ceilings are NOT applied here. arrange_to_customer
 * enforces both (check_arrangement_allocation, as migration 0050 leaves it),
 * and a second copy of that arithmetic on the client would be a second thing
 * to keep right; a line that breaks one comes back from the save as a refusal.
 */
export function resolveProposal({
  lines,
  picks,
  orders,
  records,
}: {
  lines: ProposalLine[];
  picks: BoardPick[];
  orders: BoardOrder[];
  records: BoardRecord[];
}): ResolvedProposal {
  const pickLineByGrowerVariety = new Map<string, string>();
  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      // A lot whose product did not come back has no row on the grid —
      // buildMatrix skips it — so nothing may land on it here either: it
      // would be counted, and saved, without ever having been shown.
      const variety = line.product_varieties;
      if (!variety) continue;
      pickLineByGrowerVariety.set(`${pick.grower_company_id}${SEP}${variety.id}`, line.id);
    }
  }

  // An order header is what arrange_to_customer requires of a customer, and
  // so what makes a cell writable for them — see matrix-data.ts's columns.
  const tradingCustomers = new Set(orders.map((order) => order.customer_company_id));

  // Which cells are taken. The record's customer is read the way buildMatrix
  // reads it: off the order line, with the record's own copy as the fallback
  // for a line this read of the orders does not carry.
  const orderLineOwner = new Map<string, string>();
  for (const order of orders) {
    for (const line of order.daily_order_products) {
      orderLineOwner.set(line.id, order.customer_company_id);
    }
  }
  // A record takes its cell for the customer its order line names AND for the
  // one its own copy names, should the two ever differ: that is how
  // save_arrangement_proposal judges a cell filled, and a preview that judged
  // it differently would offer, again and again, a cell the save refuses.
  const arrangedCells = new Set<string>();
  // What each customer already has of each product, against which a
  // suggested line is held to their order.
  const varietyOfPickLine = new Map<string, string>();
  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      if (line.product_varieties) varietyOfPickLine.set(line.id, line.product_varieties.id);
    }
  }
  const owed = orderedPallets(orders);
  // Who has an order at all for a product — what every line for an order needs.
  const hasOrder = new Set(owed.keys());
  for (const record of records) {
    const ownerId = orderLineOwner.get(record.daily_order_product_id) ?? record.customer_company_id;
    arrangedCells.add(`${record.daily_pick_product_id}${SEP}${ownerId}`);
    arrangedCells.add(`${record.daily_pick_product_id}${SEP}${record.customer_company_id}`);
    const varietyId = varietyOfPickLine.get(record.daily_pick_product_id);
    const pallets = Number(record.quantity_pallets);
    if (varietyId && pallets > 0) {
      const key = `${ownerId}${SEP}${varietyId}`;
      if (owed.has(key)) owed.set(key, (owed.get(key) ?? 0) - pallets);
    }
  }

  let alreadyArranged = 0;
  let unplaceable = 0;
  let heldToOrder = 0;

  // Where each line lands — or why it lands nowhere.
  const landed: Array<{
    line: ProposalLine;
    pickLineId: string;
    cell: string;
    key: string;
    quantity: number;
  }> = [];
  for (const line of lines) {
    const pickLineId = pickLineByGrowerVariety.get(`${line.growerId}${SEP}${line.varietyId}`);
    const wholePallets = Number.isInteger(line.quantity) && line.quantity > 0;
    if (!pickLineId || !tradingCustomers.has(line.customerId) || !wholePallets) {
      unplaceable += 1;
      continue;
    }

    const cell = `${pickLineId}${SEP}${line.customerId}`;
    if (arrangedCells.has(cell)) {
      alreadyArranged += 1;
      continue;
    }

    const key = `${line.customerId}${SEP}${line.varietyId}`;
    if (line.forOrder !== undefined && !hasOrder.has(key)) {
      heldToOrder += 1;
      continue;
    }
    landed.push({ line, pickLineId, cell, key, quantity: line.quantity });
  }

  // Held to the order: every number the distributor typed for the customer
  // and product is taken off it first, as typed and wherever it stands among
  // the lines — a push included, which counts against an order placed after
  // it was typed — and the suggestions get what is left, in the order they
  // came. Without that, the save would carry more than the order, and be
  // refused for it until someone found the cell.
  for (const entry of landed) {
    if (entry.line.forOrder !== "suggested") {
      owed.set(entry.key, (owed.get(entry.key) ?? 0) - entry.quantity);
    }
  }
  for (const entry of landed) {
    if (entry.line.forOrder !== "suggested") continue;
    const left = Math.max(0, Math.floor(owed.get(entry.key) ?? 0));
    if (left < entry.quantity) {
      heldToOrder += 1;
      entry.quantity = left;
    }
    owed.set(entry.key, left - entry.quantity);
  }

  // Keyed by cell so two lines for the same one become a single write. Saved
  // separately, the second would simply overwrite the first.
  const byCell = new Map<string, ProposedAllocation>();
  for (const entry of landed) {
    if (entry.quantity <= 0) continue;
    const existing = byCell.get(entry.cell);
    const forOrder = entry.line.forOrder !== undefined || existing?.forOrder === true;
    byCell.set(entry.cell, {
      pickLineId: entry.pickLineId,
      customerId: entry.line.customerId,
      quantity: (existing?.quantity ?? 0) + entry.quantity,
      ...(forOrder ? { forOrder: true } : {}),
    });
  }

  return {
    allocations: [...byCell.values()],
    alreadyArranged,
    unplaceable,
    heldToOrder,
  };
}

/**
 * Whose lot a pick line is, and of which product — the terms a ProposalLine
 * is written in. The way back from a cell on the grid, which is addressed by
 * pick line, to the proposal it shows.
 *
 * Null for a lot whose product did not come back with it, exactly as
 * resolveProposal lands nothing there: it has no row to have been typed into.
 * One grower has one lot of a product on a day (daily_picks is unique per day
 * and grower, daily_pick_products per pick and variety), so this and
 * resolveProposal's own lookup are each other's inverse.
 */
export function lotOfPickLine(
  picks: BoardPick[],
  pickLineId: string,
): { growerId: string; varietyId: string } | null {
  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      if (line.id !== pickLineId) continue;
      const variety = line.product_varieties;
      return variety ? { growerId: pick.grower_company_id, varietyId: variety.id } : null;
    }
  }
  return null;
}

/**
 * A proposal with one cell set to the quantity that was typed into it.
 *
 * SET, not added: the number in the box is the whole of what that cell is to
 * hold, so every line the proposal had for the cell is replaced by one — and
 * by none when the cell was emptied, which is how a suggestion the
 * distributor disagrees with stops being part of what gets saved. A cell the
 * proposal had nothing in is added to it: while a proposal is open, a number
 * typed into an empty cell waits for the same save as the rest.
 *
 * The line keeps the place of the one it replaces. The order of the lines is
 * the order they are saved in, and which of two cells is refused when a lot
 * runs short should not depend on which of them was last corrected.
 *
 * A quantity that is not a whole number of pallets changes nothing. The grid
 * cannot send one (see parseMatrixQuantity); this is what keeps a caller that
 * could from writing a line resolveProposal would only count as unplaceable.
 *
 * `forOrder` is whether the customer has ordered the product — the caller's
 * to say (see typeIntoProposal), and the only thing that decides it. What
 * stood in the cell before does not: a suggestion there may have gone with
 * its order, or been moved here from another grower's lot.
 */
export function setProposalCell(
  lines: ProposalLine[],
  cell: { growerId: string; varietyId: string; customerId: string },
  quantity: number,
  forOrder: boolean,
): ProposalLine[] {
  if (!Number.isInteger(quantity) || quantity < 0) return lines;

  const isCell = (line: ProposalLine) =>
    line.growerId === cell.growerId &&
    line.varietyId === cell.varietyId &&
    line.customerId === cell.customerId;
  const typed: ProposalLine[] =
    quantity > 0
      ? [
          {
            growerId: cell.growerId,
            varietyId: cell.varietyId,
            customerId: cell.customerId,
            quantity,
            ...(forOrder ? { forOrder: "typed" as const } : {}),
          },
        ]
      : [];

  const place = lines.findIndex(isCell);
  if (place === -1) return [...lines, ...typed];
  return [
    ...lines.slice(0, place),
    ...typed,
    ...lines.slice(place + 1).filter((line) => !isCell(line)),
  ];
}

/**
 * A number typed into the grid while a proposal is open: the proposal's lines
 * once it is applied, and whether it is also to be written to the database
 * now.
 *
 * A cell with nothing saved in it is the proposal's. The number is a change to
 * it — see setProposalCell — and waits for "שמור לסידור" with the rest. It is
 * for the customer's order when, on the day as read now, they have ordered
 * that product; otherwise it is a push.
 *
 * A cell with an allocation saved in it is never the proposal's, so the number
 * is written at once, as it always is. The proposal lets go of the cell too: a
 * suggestion for it sits hidden behind the record (resolveProposal lands
 * nothing on a filled cell), and emptying the cell must leave it empty rather
 * than bring that suggestion back.
 *
 * Null when the number has nowhere to go: a lot with nothing saved in it whose
 * product did not come back, which has no row to have been typed into (see
 * lotOfPickLine).
 */
export function typeIntoProposal(
  lines: ProposalLine[],
  day: { picks: BoardPick[]; orders: readonly BoardOrder[] },
  write: { pickLineId: string; customerId: string; quantity: number; recordId: string | null },
): { lines: ProposalLine[]; saveNow: boolean } | null {
  const lot = lotOfPickLine(day.picks, write.pickLineId);
  if (write.recordId) {
    return {
      lines: lot
        ? setProposalCell(lines, { ...lot, customerId: write.customerId }, 0, false)
        : lines,
      saveNow: true,
    };
  }
  if (!lot) return null;
  const forOrder = orderedPallets(day.orders).has(`${write.customerId}${SEP}${lot.varietyId}`);
  return {
    lines: setProposalCell(
      lines,
      { ...lot, customerId: write.customerId },
      write.quantity,
      forOrder,
    ),
    saveNow: false,
  };
}

/**
 * The cells a refused save names. save_arrangement_proposal (migration 0068)
 * puts them in the error's DETAIL, as JSON: the one allocation that failed,
 * or — when cells changed after the proposal was read — every one of them
 * under `cells`. Anything else names no cell.
 */
export function refusedCells(
  details: string | null | undefined,
): Array<{ pickLineId: string; customerId: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(details ?? "");
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const detail = parsed as { cells?: unknown };
  const entries: unknown[] = Array.isArray(detail.cells) ? detail.cells : [parsed];
  const cells: Array<{ pickLineId: string; customerId: string }> = [];
  for (const entry of entries) {
    const cell = entry as { dailyPickProductId?: unknown; customerCompanyId?: unknown } | null;
    if (
      typeof cell?.dailyPickProductId === "string" &&
      typeof cell.customerCompanyId === "string"
    ) {
      cells.push({ pickLineId: cell.dailyPickProductId, customerId: cell.customerCompanyId });
    }
  }
  return cells;
}

/**
 * A cell in the distributor's words — "product (grower) ← customer" — for
 * saying which one a save refused. Falls back to what it was given for a lot
 * or a customer it cannot name, rather than to nothing.
 */
export function cellLabel(
  cell: { pickLineId: string; customerId: string },
  picks: readonly BoardPick[],
  names: ReadonlyMap<string, string>,
): string {
  const customer = names.get(cell.customerId) ?? cell.customerId;
  for (const pick of picks) {
    for (const line of pick.daily_pick_products) {
      if (line.id !== cell.pickLineId) continue;
      const product = line.product_varieties
        ? formatVarietyName(line.product_varieties.name, line.product_varieties.sizes)
        : line.product_variety_id;
      const grower = names.get(pick.grower_company_id) ?? pick.grower_company_id;
      return `${product} (${grower}) ← ${customer}`;
    }
  }
  return `שורה שאינה ביום זה ← ${customer}`;
}

/**
 * What the banner says when a save was refused: nothing was saved, and why —
 * naming the cells the refusal named. `reason` is the screen's own wording of
 * the error's code (new-arrangement.tsx's describeRpcError).
 *
 * A conflict (P0006) is the one refusal that mends itself. It names cells that
 * changed after the proposal was read: somebody filled them, or the order a
 * suggested cell was for was withdrawn. Either way they drop out of the
 * proposal on the re-read that follows (see resolveProposal), so the message
 * says the rest can simply be saved again.
 */
export function saveRefusalMessage({
  error,
  picks,
  names,
  reason,
}: {
  error: { code?: string; details?: string | null };
  picks: readonly BoardPick[];
  names: ReadonlyMap<string, string>;
  reason: string;
}): string {
  const cells = refusedCells(error.details)
    .map((cell) => cellLabel(cell, picks, names))
    .join(", ");
  if (error.code === ARRANGEMENT_ERROR_CODES.CONFLICT) {
    return cells
      ? `לא נשמר דבר: תאים אלה השתנו בינתיים — שובצו, או שההזמנה שלהם בוטלה — והם ירדו מההצעה: ${cells}. אפשר לשמור שוב.`
      : "לא נשמר דבר: חלק מהתאים השתנו בינתיים, והם ירדו מההצעה. אפשר לשמור שוב.";
  }
  return cells ? `לא נשמר דבר. ${cells}: ${reason}` : `לא נשמר דבר. ${reason}`;
}
