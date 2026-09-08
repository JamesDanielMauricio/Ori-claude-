// One-shot ops script, third follow-up to seed-sample-data.ts. Run manually
// with `npx tsx scripts/seed-catalog-bulk.ts` from packages/db, with the
// root .env sourced. Not part of the shipped app.
//
// seed-product-catalog.ts got the catalog to 8 families / 16 varieties —
// enough to cover every field, not enough to test the Products screen (or
// the customer/backoffice family -> variety accordion) at real scale.
// This adds ~70 more families (real Israeli wholesale produce categories:
// vegetables, herbs, fruit — not already-used names), each with a random
// 5-12 varieties, landing the catalog in the 70-80 real-family range asked
// for.
//
// Writes go straight to product_families/product_varieties (a plain insert,
// not the save_product RPC) — confirmed safe by 0003_row-level-security.sql
// and 0006_reference-data-rls.sql: backoffice has a direct INSERT policy on
// both tables (the same policy save_product itself runs under, since it's
// security invoker), and none of these rows need save_product's other two
// jobs (the optimistic-concurrency version bump on UPDATE, or writing
// customer_pallet_caps) since every row here is a fresh create with no caps.
// Bulk inserts in chunks instead of ~700 individual RPC round-trips.
//
// Deliberately reference-data only: nothing here is assigned to any
// grower's in-season list or wired into the live trading day — this is
// catalog volume for the Products screen and the order/history accordions,
// not a claim that a real shop would carry 700 varieties in one day. See
// seed-product-catalog.ts / seed-more-sample-data.ts for the trading-day
// scenarios.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const BACKOFFICE_EMAIL = process.env.SAMPLE_LOGIN_BACKOFFICE_EMAIL ?? "";
const BACKOFFICE_PASSWORD = process.env.SAMPLE_LOGIN_BACKOFFICE_PASSWORD ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BACKOFFICE_EMAIL || !BACKOFFICE_PASSWORD) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SAMPLE_LOGIN_BACKOFFICE_EMAIL / SAMPLE_LOGIN_BACKOFFICE_PASSWORD — source the root .env first.",
  );
}

// Real produce families not already in the catalog (existing: כרוב,
// עגבניות, מלון, חסה, פלפל, מלפפון). 70 names across three categories.
const VEGETABLES = [
  "גזר", "בצל", "תפוח אדמה", "חציל", "קישוא", "דלעת", "שום", "כרישה", "סלק",
  "צנונית", "כרובית", "ברוקולי", "תרד", "ארטישוק", "שומר", "אפונה",
  "שעועית ירוקה", "תירס", "בטטה", "כרוב ניצנים", "סלרי", "אספרגוס", "עולש",
  "רוקט", "באמיה", "לפת",
];
const HERBS = ["פטרוזיליה", "כוסברה", "שמיר", "נענע", "בזיליקום", "טימין", "רוזמרין", "אורגנו", "עירית", "מרווה"];
const FRUITS = [
  "תפוח עץ", "אגס", "אפרסק", "נקטרינה", "משמש", "שזיף", "ענבים", "תות שדה",
  "אוכמניות", "פטל", "תאנה", "רימון", "אבטיח", "תפוז", "קלמנטינה", "לימון",
  "אשכולית", "מנדרינה", "בננה", "מנגו", "אבוקדו", "קיווי", "שסק", "תמר",
  "אננס", "ליצ'י", "פסיפלורה", "פומלה", "דובדבן", "גויאבה", "קוקוס",
  "קרמבולה", "שקד", "אגוז מלך",
];

const DESCRIPTORS = [
  "גדול", "בינוני", "קטן", "פרימיום", "אורגני", "מיובא", "מקומי",
  "כיתה א׳", "כיתה ב׳", "חממה", "שדה", "מיוחד",
];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

interface FamilyDef {
  name: string;
  category: string;
}

interface VarietyRow {
  family_id: string;
  name: string;
  pack_type: "pallets" | "crates";
  price: number | null;
  price_range_from: number | null;
  price_range_to: number | null;
  price_type: string | null;
  no_overbooking: number;
  highlight_price_fluctuations: boolean;
  is_seasonal_available: boolean;
  version: number;
}

function buildVarietyRow(familyId: string, familyName: string, descriptor: string): VarietyRow {
  const isRanged = Math.random() < 0.1;
  const base = randomInt(4, 40);
  return {
    family_id: familyId,
    name: `${familyName} ${descriptor}`,
    pack_type: Math.random() < 0.2 ? "crates" : "pallets",
    price: isRanged ? null : base,
    price_range_from: isRanged ? base : null,
    price_range_to: isRanged ? Math.round(base * (1.2 + Math.random() * 0.2)) : null,
    price_type: isRanged ? ["לפי גודל", "לפי איכות", "לפי משקל"][randomInt(0, 2)]! : null,
    no_overbooking: Math.random() < 0.1 ? randomInt(1, 3) : 0,
    highlight_price_fluctuations: Math.random() < 0.05,
    is_seasonal_available: Math.random() >= 0.1,
    version: 1,
  };
}

async function insertChunked<T extends object>(
  client: SupabaseClient,
  table: string,
  rows: T[],
  chunkSize: number,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client.from(table).insert(chunk);
    if (error) throw new Error(`insert ${table} chunk ${i}-${i + chunk.length} failed: ${error.message}`);
    console.log(`  inserted ${table} rows ${i + 1}-${i + chunk.length} of ${rows.length}`);
  }
}

async function main() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({
    email: BACKOFFICE_EMAIL,
    password: BACKOFFICE_PASSWORD,
  });
  if (signInError) throw new Error(`backoffice sign-in failed: ${signInError.message}`);
  console.log(`Signed in as backoffice (${BACKOFFICE_EMAIL}).`);

  const familyDefs: FamilyDef[] = [
    ...VEGETABLES.map((name) => ({ name, category: "ירק" })),
    ...HERBS.map((name) => ({ name, category: "עשב תיבול" })),
    ...FRUITS.map((name) => ({ name, category: "פרי" })),
  ];
  console.log(`\n== Inserting ${familyDefs.length} product families ==`);

  const familyRows = familyDefs.map((f, i) => ({
    name: f.name,
    category: f.category,
    image_url: `https://picsum.photos/seed/ori-fam-${i}/300`,
  }));

  const { data: insertedFamilies, error: familyError } = await client
    .from("product_families")
    .insert(familyRows)
    .select("id, name");
  if (familyError) throw new Error(`insert product_families failed: ${familyError.message}`);
  console.log(`  inserted ${insertedFamilies!.length} families`);

  console.log("\n== Building varieties (5-12 per family) ==");
  const varietyRows: VarietyRow[] = [];
  for (const family of insertedFamilies as Array<{ id: string; name: string }>) {
    const count = randomInt(5, 12);
    const descriptors = shuffle(DESCRIPTORS).slice(0, count);
    for (const descriptor of descriptors) {
      varietyRows.push(buildVarietyRow(family.id, family.name, descriptor));
    }
  }
  console.log(`  built ${varietyRows.length} varieties across ${insertedFamilies!.length} families`);

  console.log("\n== Inserting varieties ==");
  await insertChunked(client, "product_varieties", varietyRows, 250);

  console.log("\n== Done ==");
  console.log(
    JSON.stringify(
      { familiesAdded: insertedFamilies!.length, varietiesAdded: varietyRows.length },
      null,
      2,
    ),
  );
}

void main();
