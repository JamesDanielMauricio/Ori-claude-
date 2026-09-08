// One-shot ops script, fourth follow-up to seed-sample-data.ts. Run
// manually with `npx tsx scripts/wire-bulk-catalog-to-grower.ts` from
// packages/db, with the root .env sourced. Not part of the shipped app.
//
// seed-catalog-bulk.ts added ~600 varieties across ~70 families as pure
// reference data — nothing a customer or grower screen ever renders unless
// a grower actually carries it. This wires that entire batch onto Grower
// 04 (currently active with zero grower_products — untouched by every
// other seed script), via a single save_grower call, to stress-test the
// shop/order/pick screens with a genuinely large assortment in the live
// 2026-09-08 trading day instead of the ~10 items they had.
//
// save_grower (0037) auto-syncs the currently-open trading day's Daily
// Pick for whichever grower it's called on, so this one RPC call both
// assigns the in-season list AND bootstraps ~600 daily_pick_products lines
// for Grower 04 on today's day. Grower 04's pick is deliberately left in
// 'draft' — both because shop_variety_orderability doesn't care about pick
// status (draft supply counts the same as submitted supply), and because
// an unsubmitted 600-line pick is itself a useful case for stress-testing
// the grower pick-lines-editor screen.
//
// pallets_picked can't be set per-line through save_grower or the bulk
// insert RLS trick seed-catalog-bulk.ts used — daily_pick_products has no
// direct-write policy for anyone but backoffice's RPCs *and* a plain
// backoffice write policy (0010's daily_pick_products_write_backoffice),
// so this bulk-upserts pallets_picked directly afterwards instead of ~600
// individual update_pick_product_pallets calls.
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

const GROWER_04 = "f3f6d8e9-58bb-4b5e-a52b-19565bcfa4b0";
const LIVE_DAY_ID = "af133ca5-98b7-47e8-9f75-cc7faf8e0f67";

// The exact 70 family names seed-catalog-bulk.ts created — used here only
// to find those families' varieties again (their ids weren't persisted
// anywhere after that script exited).
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
const BULK_FAMILY_NAMES = [...VEGETABLES, ...HERBS, ...FRUITS];

interface Company {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
}

async function rpc<T = unknown>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  console.log(`  rpc ${name} ok`);
  return data as T;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function main() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({
    email: BACKOFFICE_EMAIL,
    password: BACKOFFICE_PASSWORD,
  });
  if (signInError) throw new Error(`backoffice sign-in failed: ${signInError.message}`);
  console.log(`Signed in as backoffice (${BACKOFFICE_EMAIL}).`);

  console.log("\n== Finding seed-catalog-bulk.ts's ~600 varieties ==");
  const { data: families, error: familiesError } = await client
    .from("product_families")
    .select("id")
    .in("name", BULK_FAMILY_NAMES);
  if (familiesError) throw new Error(`fetch product_families failed: ${familiesError.message}`);
  const familyIds = (families ?? []).map((f: { id: string }) => f.id);
  console.log(`  found ${familyIds.length} families (expected ${BULK_FAMILY_NAMES.length})`);

  const { data: varieties, error: varietiesError } = await client
    .from("product_varieties")
    .select("id")
    .in("family_id", familyIds);
  if (varietiesError) throw new Error(`fetch product_varieties failed: ${varietiesError.message}`);
  const varietyIds = (varieties ?? []).map((v: { id: string }) => v.id);
  console.log(`  found ${varietyIds.length} varieties`);

  console.log("\n== Assigning them all to Grower 04 ==");
  const { data: grower04, error: growerError } = await client
    .from("companies")
    .select("*")
    .eq("id", GROWER_04)
    .single();
  if (growerError) throw new Error(`fetch Grower 04 failed: ${growerError.message}`);
  const current = grower04 as Company;

  await rpc(client, "save_grower", {
    p_id: GROWER_04,
    p_name: current.name,
    p_status: current.status,
    p_default_pickup_time: current.default_pickup_time,
    p_whatsapp_group_id: current.whatsapp_group_id,
    p_product_variety_ids: varietyIds,
    p_transporter_company_id: current.transporter_company_id,
  });
  console.log(`  Grower 04 now carries ${varietyIds.length} varieties; save_grower auto-synced today's Daily Pick`);

  console.log("\n== Setting pallets_picked on Grower 04's new pick lines ==");
  const { data: pick, error: pickError } = await client
    .from("daily_picks")
    .select("id")
    .eq("trading_day_id", LIVE_DAY_ID)
    .eq("grower_company_id", GROWER_04)
    .single();
  if (pickError) throw new Error(`fetch Grower 04's live-day pick failed: ${pickError.message}`);
  const pickId = (pick as { id: string }).id;

  const { data: pickLines, error: pickLinesError } = await client
    .from("daily_pick_products")
    .select("id, product_variety_id")
    .eq("daily_pick_id", pickId);
  if (pickLinesError) throw new Error(`fetch daily_pick_products failed: ${pickLinesError.message}`);
  console.log(`  ${pickLines!.length} pick lines to update`);

  const upsertRows = (pickLines as Array<{ id: string; product_variety_id: string }>).map((line) => ({
    id: line.id,
    daily_pick_id: pickId,
    product_variety_id: line.product_variety_id,
    // ~15% left unpicked (0), matching a large grower still entering the day's harvest.
    pallets_picked: Math.random() < 0.15 ? 0 : randomInt(5, 40),
  }));

  const chunkSize = 250;
  for (let i = 0; i < upsertRows.length; i += chunkSize) {
    const chunk = upsertRows.slice(i, i + chunkSize);
    const { error } = await client.from("daily_pick_products").upsert(chunk);
    if (error) throw new Error(`upsert daily_pick_products chunk ${i}-${i + chunk.length} failed: ${error.message}`);
    console.log(`  updated pallets_picked for rows ${i + 1}-${i + chunk.length} of ${upsertRows.length}`);
  }

  console.log("\n== Done ==");
  console.log(`Grower 04's pick (${pickId}) left in draft, ${upsertRows.length} lines, most with real stock.`);
}

void main();
