// The single place both the main order screen and the submission
// confirmation popup turn `get_orderable_catalog_for_customer`'s
// variety-level rows into family groups. There is no second,
// family-level filter anywhere — a family shows up here iff at least one
// of its variety rows made it into the `rows` array being grouped. The
// browse view groups the full catalog; the confirmation view groups the
// same rows pre-filtered to a positive draft quantity. Same function,
// different input — never two implementations that are each supposed to
// agree (see packages/db/migrations/0018_customer-order-functions.sql's
// header comment for the backend half of this rule).

export interface CatalogRow {
  family_id: string;
  family_name: string;
  variety_id: string;
  variety_name: string;
  pack_type: "pallets" | "crates" | null;
  price: number | null;
  price_range_from: number | null;
  price_range_to: number | null;
  price_type: string | null;
  is_orderable: boolean;
  pallets_ordered: number;
  comment: string | null;
}

export interface FamilyGroup {
  familyId: string;
  familyName: string;
  varieties: CatalogRow[];
}

export function groupCatalogByFamily(rows: CatalogRow[]): FamilyGroup[] {
  const groups = new Map<string, FamilyGroup>();
  for (const row of rows) {
    let group = groups.get(row.family_id);
    if (!group) {
      group = { familyId: row.family_id, familyName: row.family_name, varieties: [] };
      groups.set(row.family_id, group);
    }
    group.varieties.push(row);
  }
  return [...groups.values()].sort((a, b) => a.familyName.localeCompare(b.familyName, "he"));
}

export function formatPrice(row: Pick<CatalogRow, "price" | "price_range_from" | "price_range_to">): string | null {
  if (row.price != null) return `₪${row.price}`;
  if (row.price_range_from != null && row.price_range_to != null) {
    return `₪${row.price_range_from}–₪${row.price_range_to}`;
  }
  return null;
}
