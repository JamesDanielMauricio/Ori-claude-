import { toInputText } from "@/lib/number-field";
import type { PalletCap, ProductFamily, ProductVariety } from "@/lib/queries/reference-data";

// The Products screen's form state, constants and pure helpers — no React
// state, no queries. Shared by the screen and its split-out parts.

export type PackType = "pallets" | "crates";

export interface FormState {
  familyId: string;
  name: string;
  sizes: string;
  packType: PackType | "";
  price: string;
  priceRangeFrom: string;
  priceRangeTo: string;
  priceType: string;
  noOverbooking: string;
  highlightPriceFluctuations: boolean;
  isSeasonalAvailable: boolean;
  // Empty string = no variety-level cap (see product-variety.ts's schema
  // comment). Kept as a string here for the same reason every other numeric
  // form field is: an <input> can't hold `null`.
  numberOfOrdersPerCustomer: string;
  version: number | null;
  customerPalletCaps: PalletCap[];
}

// Sentinel row id for a not-yet-created record: the draft row prepended to
// the table while `onAdd` is active, so RecordTable's "is this row being
// edited" logic (which compares ids) needs no separate create/update
// concept of its own.
export const NEW_ROW_ID = "__new__";

// The same idea one level up: a not-yet-created FAMILY, prepended to the
// group list as a header row already in edit mode. RecordTable pins the
// group whose id is `editingId`, so an unnamed draft survives whatever is
// in the search box.
export const NEW_FAMILY_ID = "__new_family__";

export const CREATED_AT_FORMAT = new Intl.DateTimeFormat("he-IL", { dateStyle: "short" });

// Storage backing for a family's photo (0058_product-photo-storage-bucket.sql).
// Mirrors that migration's `allowed_mime_types` / `file_size_limit` so a
// rejected file gets a Hebrew toast here rather than a raw Storage API error
// — Storage itself is still the real enforcement, since a client-side-only
// check can always be bypassed by calling the API directly.
export const PRODUCT_PHOTOS_BUCKET = "product-photos";
export const PHOTO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

// Only a URL this app itself uploaded (via getPublicUrl, below) is ever
// eligible for deletion — anything else, such as a URL pasted before this
// feature existed or one carried over from the Bubble import, is left alone
// because we don't own it and can't tell whether something else still reads
// it.
export function productPhotoPathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${PRODUCT_PHOTOS_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

export const PACK_TYPE_LABEL: Record<PackType, string> = { pallets: "משטחים", crates: "ארגזים" };

// An empty cell is a value too, and on this screen most varieties leave most
// of the optional pricing fields unset — so a placeholder drawn in the same
// ink as real data turns the table into a field of dashes with the handful of
// actual numbers lost somewhere inside it. Drawn in the subtle ink instead:
// still plainly "nothing set here", but no longer competing with the values
// that ARE set. An empty string counts as unset for the same reason `||` did
// before: these columns come back as "" rather than null when the source row
// has never been given one.
export function orDash(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-subtle">—</span>;
  }
  return value;
}

// The name column carries a family's expand chevron and photo as well as a
// name — and those two pushed the family name 4rem inboard of the varieties
// listed directly underneath it, so the parent read as drifting away from its
// own children. They now sit in a fixed-width gutter instead, and a variety's
// name is padded by exactly that width, which puts every name in the column
// on one edge whichever level it belongs to. Two halves of one measurement,
// so they are declared together and must stay equal: `w-16` is 4rem and so is
// `ps-16`. It costs the column nothing, because its width was already set by
// the longest family name plus this same gutter.
export const NAME_GUTTER = "w-16";
export const NAME_GUTTER_PAD = "ps-16";

export function blankForm(defaultFamilyId: string): FormState {
  return {
    familyId: defaultFamilyId,
    name: "",
    sizes: "",
    packType: "",
    price: "",
    priceRangeFrom: "",
    priceRangeTo: "",
    priceType: "",
    noOverbooking: "0",
    highlightPriceFluctuations: false,
    isSeasonalAvailable: true,
    numberOfOrdersPerCustomer: "",
    version: null,
    customerPalletCaps: [],
  };
}

// `familyId` is the one field the draft row carries for real: the table
// buckets rows into family groups by it, so a draft that held "" would sit
// in no family at all and render outside every group. Threading the form's
// current selection through means changing the משפחה dropdown mid-draft
// visibly moves the half-filled row into the family it will be saved to.
export function blankRow(familyId: string): ProductVariety {
  return {
    id: NEW_ROW_ID,
    family_id: familyId,
    name: "",
    sizes: null,
    pack_type: null,
    price: null,
    price_range_from: null,
    price_range_to: null,
    price_type: null,
    no_overbooking: 0,
    highlight_price_fluctuations: false,
    is_seasonal_available: true,
    number_of_orders_per_customer: null,
    version: 0,
    created_at: "",
  };
}

export interface FamilyFormState {
  name: string;
  category: string;
  imageUrl: string;
}

export function blankFamilyForm(): FamilyFormState {
  return { name: "", category: "", imageUrl: "" };
}

export function toFamilyForm(family: ProductFamily): FamilyFormState {
  return {
    name: family.name,
    category: family.category ?? "",
    imageUrl: family.image_url ?? "",
  };
}

// Hebrew takes no bare numeral before a plural for one: "1 זנים" is wrong
// where "זן אחד" is right, and an empty family reads as "אין זנים" rather
// than "0 זנים". Used by both the header chip and the delete dialog's
// explanation, so the two can't disagree about how to count.
export function varietyCountLabel(count: number): string {
  if (count === 0) return "אין זנים";
  if (count === 1) return "זן אחד";
  return `${count} זנים`;
}

// The synthetic family a draft header row is drawn from. Only the id is
// ever read while it's on screen — every field shown comes from
// `familyForm` — but it keeps the header renderer working off one type
// instead of branching on "is this a real family or a draft".
export function blankFamily(): ProductFamily {
  return { id: NEW_FAMILY_ID, name: "", category: null, image_url: null };
}

// The form holds text (see FormState); the numeric columns arrive as
// numbers. Converting here also keeps both sides of `hasChanges` the same
// shape — a number baseline against a typed string read as "changed" even
// when the same value was typed back in.
export function toFormState(row: ProductVariety, caps: PalletCap[]): FormState {
  return {
    familyId: row.family_id,
    name: row.name,
    sizes: row.sizes ?? "",
    packType: row.pack_type ?? "",
    price: toInputText(row.price),
    priceRangeFrom: toInputText(row.price_range_from),
    priceRangeTo: toInputText(row.price_range_to),
    priceType: row.price_type ?? "",
    noOverbooking: String(row.no_overbooking),
    highlightPriceFluctuations: row.highlight_price_fluctuations,
    isSeasonalAvailable: row.is_seasonal_available,
    numberOfOrdersPerCustomer:
      row.number_of_orders_per_customer == null ? "" : String(row.number_of_orders_per_customer),
    version: row.version,
    customerPalletCaps: caps,
  };
}
