// The single place the main order screen, the submission confirmation
// popup, and (via groupCatalogForBrowsing below) every "order on someone's
// behalf" screen turn `get_orderable_catalog_for_customer`'s variety-level
// rows into family groups. There is no second, family-level filter
// anywhere — a family shows up here iff at least one of its variety rows
// made it into the `rows` array being grouped. The browse view groups the
// full catalog; the confirmation view groups the same rows pre-filtered to
// a positive draft quantity. Same function, different input — never two
// implementations that are each supposed to agree (see
// packages/db/migrations/0018_customer-order-functions.sql's header
// comment for the backend half of this rule).

export interface CatalogRow {
  family_id: string;
  family_name: string;
  variety_id: string;
  variety_name: string;
  sizes: string | null;
  pack_type: "pallets" | "crates" | null;
  price: number | null;
  price_range_from: number | null;
  price_range_to: number | null;
  price_type: string | null;
  is_orderable: boolean;
  pallets_ordered: number;
  comment: string | null;
  // The variety's FAMILY's photo (product_families.image_url, added by
  // migration 0036_product-variety-images.sql — applied 2026-09-08). The
  // RPC repeats the same value across every variety row in a family;
  // groupCatalogByFamily below reads it once per group. Still null for
  // every family until a real photo URL is set per family; ProductThumbnail
  // falls back to a generic icon either way.
  image_url: string | null;
  // This customer's own ceiling for this row (migration 0042's
  // max_orderable_for_customer): least(the variety's per-customer cap,
  // remaining stock excluding demand from every OTHER customer), floored at
  // 0. Sizes the quantity dropdown on the customer's own order screen —
  // never treated as a hard limit on the backoffice on-behalf-of path.
  max_orderable_for_customer: number;
}

export interface FamilyGroup {
  familyId: string;
  familyName: string;
  imageUrl: string | null;
  varieties: CatalogRow[];
}

export function groupCatalogByFamily(rows: CatalogRow[]): FamilyGroup[] {
  const groups = new Map<string, FamilyGroup>();
  for (const row of rows) {
    let group = groups.get(row.family_id);
    if (!group) {
      group = {
        familyId: row.family_id,
        familyName: row.family_name,
        imageUrl: row.image_url ?? null,
        varieties: [],
      };
      groups.set(row.family_id, group);
    }
    group.varieties.push(row);
  }
  return [...groups.values()].sort((a, b) => a.familyName.localeCompare(b.familyName, "he"));
}

// The browse view's ordering: families the customer already has an order
// against sort before ones they haven't touched, each band staying
// alphabetical inside itself. groupCatalogByFamily's output is already
// alphabetical and Array.prototype.sort is a stable sort, so partitioning
// by "has an order" is the whole implementation — no second comparator is
// needed to keep either band in name order.
//
// "Has an order" is read off `pallets_ordered` on the rows as fetched —
// the server's own copy of the order, never a caller's in-progress draft.
// This runs on every keystroke in OrderLinesEditor (the family list is
// recomputed live so quantity inputs reflect what was typed), and keying
// the sort off the draft would move a row to band one the moment its first
// digit was typed — reordering the list under the person still filling it
// in is worse than the unordered list this function replaces.
export function groupCatalogForBrowsing(rows: CatalogRow[]): FamilyGroup[] {
  const groups = groupCatalogByFamily(rows);
  const hasOrder = (group: FamilyGroup) => group.varieties.some((row) => row.pallets_ordered > 0);
  return [...groups].sort((a, b) => Number(hasOrder(b)) - Number(hasOrder(a)));
}

export function formatPrice(
  row: Pick<CatalogRow, "price" | "price_range_from" | "price_range_to">,
): string | null {
  if (row.price != null) return `₪${row.price}`;
  if (row.price_range_from != null && row.price_range_to != null) {
    return `₪${row.price_range_from}–₪${row.price_range_to}`;
  }
  return null;
}

// "ליום רביעי ה- 10.7.24" — the reference design's date pill wording, used
// by both the live order screen's header and the read-only historical
// order view.
export function weekdayDateLabel(isoDate: string): string {
  const date = new Date(isoDate);
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(date);
  const shortDate = new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  }).format(date);
  return `ל${weekday} ה- ${shortDate}`;
}
