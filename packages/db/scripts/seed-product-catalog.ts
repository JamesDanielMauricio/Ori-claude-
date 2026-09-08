// One-shot ops script, second follow-up to seed-sample-data.ts. Run
// manually with `npx tsx scripts/seed-product-catalog.ts` from packages/db,
// with the root .env sourced. Not part of the shipped app.
//
// The catalog so far only had 3 real families / 4 real varieties (plus two
// leftover "Test Family/Variety <uuid>" rows from unrelated testing, left
// alone here). That's too thin to exercise the Products screen
// (apps/web/src/routes/backoffice/products.tsx) across its actual range:
// both pack types, a fixed price AND a price range AND a free-text price
// type, no_overbooking > 0, highlight_price_fluctuations, a second
// customer pallet cap, and an out-of-season variety that must stay hidden
// from the shop and pick lists.
//
// This adds 3 new families and 9 new varieties covering that range, then
// assigns 6 of the 9 to Growers 01-03's in-season lists via save_grower —
// which (since migration 0037) auto-syncs that grower's Daily Pick for
// whichever trading day is currently open, so the new lines show up
// immediately in the live 2026-09-08 day from seed-more-sample-data.ts
// without needing a separate bootstrap call. Three varieties (חסה רומית,
// פלפל צהוב, מלפפון בייבי, and the out-of-season מלון חורף) are
// deliberately left unassigned to any grower — catalog rows that exist for
// the Products screen but never surface in a shop, on purpose.
//
// Deliberately does not touch any customer order — the live day's
// untouched/reminded-but-silent customers (08/09) from seed-more-sample-data
// stay exactly as they were, and the new in-stock lines are left for you to
// order against by hand in the running app.
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

const GROWER_01 = "292c4d5e-b2a7-4994-83cf-db937d38029e";
const GROWER_02 = "a765356d-2501-4fd8-bbe8-e7590caae862";
const GROWER_03 = "d696a600-e1a0-40cc-9479-902f9c24895c";
const CUSTOMER_03 = "83f84064-cbea-4612-a295-d88b18420581";

// The live day from seed-more-sample-data.ts. Growers now have a
// daily_picks row on both this day and the closed 2026-08-20 one, so every
// pick lookup below must be scoped to this trading day or fetchOne's
// .single() would find two rows and error.
const LIVE_DAY_ID = "af133ca5-98b7-47e8-9f75-cc7faf8e0f67";

// Existing real varieties (created by seed-sample-data.ts) that Growers
// 01-03 already carry — save_grower replaces the whole in-season list, so
// these must be re-sent alongside the new ones or they'd be dropped (and,
// since sync_grower_picks prunes pick lines for anything no longer
// in-season, that would delete today's already-picked cabbage/tamar/etc.
// lines too).
const CABBAGE = "475d8c75-026c-494b-ad6a-ce07a574045c";
const TAMAR = "95dd4d2e-fa1c-4743-a112-286d4e8f385f";
const CLUSTER = "615074ea-ebd4-49d7-9b4a-ca9c2ce5d013";
const MELON = "9b842116-dd28-4590-bb59-e4b71caa8ac5";

async function rpc<T = unknown>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}(${JSON.stringify(args)}) failed: ${error.message}`);
  console.log(`  rpc ${name}(${(args.p_name as string) ?? ""}) ok`);
  return data as T;
}

async function fetchOne<T>(client: SupabaseClient, table: string, match: Record<string, unknown>): Promise<T> {
  let query = client.from(table).select("*");
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { data, error } = await query.single();
  if (error) throw new Error(`fetch ${table} ${JSON.stringify(match)} failed: ${error.message}`);
  return data as T;
}

interface Company {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
}

interface CustomerPalletCap {
  customerCompanyId: string;
  palletCap: number;
}

async function saveProduct(
  client: SupabaseClient,
  args: {
    familyId: string;
    name: string;
    packType?: "pallets" | "crates" | null;
    price?: number | null;
    priceRangeFrom?: number | null;
    priceRangeTo?: number | null;
    priceType?: string | null;
    noOverbooking?: number;
    highlightPriceFluctuations?: boolean;
    isSeasonalAvailable?: boolean;
    customerPalletCaps?: CustomerPalletCap[];
  },
): Promise<{ id: string }> {
  return rpc(client, "save_product", {
    p_id: null,
    p_family_id: args.familyId,
    p_name: args.name,
    p_sizes: null,
    p_pack_type: args.packType ?? "pallets",
    p_price: args.price ?? null,
    p_price_range_from: args.priceRangeFrom ?? null,
    p_price_range_to: args.priceRangeTo ?? null,
    p_price_type: args.priceType ?? null,
    p_no_overbooking: args.noOverbooking ?? 0,
    p_highlight_price_fluctuations: args.highlightPriceFluctuations ?? false,
    p_is_seasonal_available: args.isSeasonalAvailable ?? true,
    p_expected_version: null,
    p_customer_pallet_caps: args.customerPalletCaps ?? [],
  });
}

async function saveGrower(client: SupabaseClient, companyId: string, varietyIds: string[]): Promise<void> {
  const current = await fetchOne<Company>(client, "companies", { id: companyId });
  await rpc(client, "save_grower", {
    p_id: companyId,
    p_name: current.name,
    p_status: current.status,
    p_default_pickup_time: current.default_pickup_time,
    p_whatsapp_group_id: current.whatsapp_group_id,
    p_product_variety_ids: varietyIds,
    p_transporter_company_id: current.transporter_company_id,
  });
}

async function main() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({
    email: BACKOFFICE_EMAIL,
    password: BACKOFFICE_PASSWORD,
  });
  if (signInError) throw new Error(`backoffice sign-in failed: ${signInError.message}`);
  console.log(`Signed in as backoffice (${BACKOFFICE_EMAIL}).`);

  console.log("\n== New product families ==");
  const familyDefs = [
    { name: "חסה", image_url: "https://picsum.photos/seed/ori-lettuce/300" },
    { name: "פלפל", image_url: "https://picsum.photos/seed/ori-pepper/300" },
    { name: "מלפפון", image_url: "https://picsum.photos/seed/ori-cucumber/300" },
  ];
  const familyIds: Record<string, string> = {};
  for (const family of familyDefs) {
    const { data, error } = await client
      .from("product_families")
      .insert({ name: family.name, image_url: family.image_url })
      .select("id")
      .single();
    if (error) throw new Error(`insert product_families(${family.name}) failed: ${error.message}`);
    familyIds[family.name] = (data as { id: string }).id;
    console.log(`  family "${family.name}" -> ${familyIds[family.name]}`);
  }
  function familyId(name: string): string {
    const id = familyIds[name];
    if (!id) throw new Error(`seed bug: no product family was created for "${name}"`);
    return id;
  }

  // Need כרוב's and עגבניות's and מלון's existing family ids too (not just
  // the new ones), to add sibling varieties to them.
  const existingFamilies = await client.from("product_families").select("id, name").in("name", ["כרוב", "עגבניות", "מלון"]);
  if (existingFamilies.error) throw new Error(existingFamilies.error.message);
  for (const row of existingFamilies.data as Array<{ id: string; name: string }>) {
    familyIds[row.name] = row.id;
  }

  console.log("\n== New product varieties ==");
  const purpleCabbage = await saveProduct(client, {
    familyId: familyId("כרוב"),
    name: "כרוב סגול",
    packType: "crates",
    price: 9,
  });
  const cherryTomato = await saveProduct(client, {
    familyId: familyId("עגבניות"),
    name: "עגבנית שרי",
    priceRangeFrom: 18,
    priceRangeTo: 22,
    priceType: "לפי איכות",
  });
  const yellowMelon = await saveProduct(client, {
    familyId: familyId("מלון"),
    name: "מלון צהוב",
    packType: "crates",
    price: 11,
  });
  const winterMelon = await saveProduct(client, {
    familyId: familyId("מלון"),
    name: "מלון חורף",
    price: 9,
    isSeasonalAvailable: false,
  });
  const icebergLettuce = await saveProduct(client, {
    familyId: familyId("חסה"),
    name: "חסה אייסברג",
    price: 6,
    noOverbooking: 3,
    customerPalletCaps: [{ customerCompanyId: CUSTOMER_03, palletCap: 4 }],
  });
  const romaineLettuce = await saveProduct(client, { familyId: familyId("חסה"), name: "חסה רומית", price: 7 });
  const redPepper = await saveProduct(client, {
    familyId: familyId("פלפל"),
    name: "פלפל אדום",
    priceRangeFrom: 14,
    priceRangeTo: 18,
  });
  const yellowPepper = await saveProduct(client, {
    familyId: familyId("פלפל"),
    name: "פלפל צהוב",
    price: 16,
    highlightPriceFluctuations: true,
  });
  const crateCucumber = await saveProduct(client, {
    familyId: familyId("מלפפון"),
    name: "מלפפון מארז",
    packType: "crates",
    price: 5,
  });
  const babyCucumber = await saveProduct(client, { familyId: familyId("מלפפון"), name: "מלפפון בייבי", price: 13 });

  console.log("  new variety ids:", {
    purpleCabbage: purpleCabbage.id,
    cherryTomato: cherryTomato.id,
    yellowMelon: yellowMelon.id,
    winterMelon: winterMelon.id,
    icebergLettuce: icebergLettuce.id,
    romaineLettuce: romaineLettuce.id,
    redPepper: redPepper.id,
    yellowPepper: yellowPepper.id,
    crateCucumber: crateCucumber.id,
    babyCucumber: babyCucumber.id,
  });
  console.log("  (חסה רומית, פלפל צהוב, מלפפון בייבי, מלון חורף left unassigned to any grower on purpose)");

  console.log("\n== Assigning new varieties into Growers 01-03's in-season lists ==");
  // save_grower replaces the whole list — existing varieties are re-sent so
  // they aren't dropped, and (since 0037) this auto-syncs the currently
  // open trading day's Daily Pick lines for each grower in the same call.
  await saveGrower(client, GROWER_01, [CABBAGE, TAMAR, purpleCabbage.id, redPepper.id]);
  await saveGrower(client, GROWER_02, [CLUSTER, MELON, cherryTomato.id, crateCucumber.id]);
  await saveGrower(client, GROWER_03, [CABBAGE, MELON, icebergLettuce.id, yellowMelon.id]);
  console.log("  Grower 01 += כרוב סגול, פלפל אדום");
  console.log("  Grower 02 += עגבנית שרי, מלפפון מארז");
  console.log("  Grower 03 += חסה אייסברג, מלון צהוב");

  console.log("\n== Setting picked pallets on the newly-synced live-day pick lines ==");
  const pickG1 = await fetchOne<{ id: string }>(client, "daily_picks", { trading_day_id: LIVE_DAY_ID, grower_company_id: GROWER_01 });
  const pickG2 = await fetchOne<{ id: string }>(client, "daily_picks", { trading_day_id: LIVE_DAY_ID, grower_company_id: GROWER_02 });
  const pickG3 = await fetchOne<{ id: string }>(client, "daily_picks", { trading_day_id: LIVE_DAY_ID, grower_company_id: GROWER_03 });

  const g1PurpleCabbage = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG1.id, product_variety_id: purpleCabbage.id });
  const g2CherryTomato = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG2.id, product_variety_id: cherryTomato.id });
  const g2CrateCucumber = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG2.id, product_variety_id: crateCucumber.id });
  const g3IcebergLettuce = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG3.id, product_variety_id: icebergLettuce.id });

  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g1PurpleCabbage.id, p_pallets_picked: 6 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g2CherryTomato.id, p_pallets_picked: 5 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g2CrateCucumber.id, p_pallets_picked: 4 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g3IcebergLettuce.id, p_pallets_picked: 3 });
  // פלפל אדום (Grower 01) and מלון צהוב (Grower 03) are deliberately left at
  // their default 0 pallets_picked — assigned mid-day, not picked yet.
  console.log("  picked: כרוב סגול=6, עגבנית שרי=5, מלפפון מארז=4, חסה אייסברג=3 (פלפל אדום and מלון צהוב left at 0)");

  console.log("\n== Done ==");
}

void main();
