// One-shot ops script: seeds realistic sample data across every table in
// the schema by driving the app's own real RPCs end-to-end as a signed-in
// backoffice session (per the user's explicit choice — see the
// conversation this was written for), the same way apps/web/e2e/*.spec.ts
// already exercises this exact hosted Supabase project. Not part of the
// shipped app; run manually with `npx tsx scripts/seed-sample-data.ts`
// from packages/db, with the root .env sourced.
//
// Two trading-day lifecycles:
//   - Cycle A: finishes the trading day that was ALREADY open (initiated)
//     in this project when this script was written, all the way to
//     'closed' — gives every table a real, fully historical row
//     (arrangement_records, notification_outbox, alerts, lifecycle_sessions,
//     order_submission_logs), including one deliberate ordered-vs-arranged
//     mismatch (Customer 03's melon line) mirroring the dispute-highlighting
//     scenario apps/web/e2e/order-history.spec.ts already covers.
//   - Cycle B: a brand-new day, left at 'shop_open' (never closed) — the
//     live, currently-orderable day the customer order/history screens
//     were built against, with one submitted order (Customer 02, "נשלח")
//     and one untouched draft (Customer 01, "חדש").
//
// Deliberately bypasses @ori/domain's schema/RpcArgs helpers (packages/db
// has no dependency on @ori/domain, and adding one for a one-off script
// isn't worth the workspace-graph change) — every arg shape below was
// copied verbatim from the actual migration that defines each function
// (cited inline), not guessed.
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

// Existing companies in this project (queried directly, not guessed —
// see the conversation's inspect-state.tmp.ts output). Reused rather than
// creating new ones, since every "Grower 0N"/"Customer 0N" already has a
// real profile.
const GROWER_01 = "292c4d5e-b2a7-4994-83cf-db937d38029e";
const GROWER_02 = "a765356d-2501-4fd8-bbe8-e7590caae862";
const GROWER_03 = "d696a600-e1a0-40cc-9479-902f9c24895c";
const CUSTOMER_01 = "77023710-32b5-4e76-88db-0ec09d0f90b1";
const CUSTOMER_02 = "c43f19d4-04f4-4b3e-a9b5-b345270a9ced";
const CUSTOMER_03 = "83f84064-cbea-4612-a295-d88b18420581";
const CUSTOMER_04 = "6b0420a2-a65d-4330-bdc3-312fe2adba8a";
const CUSTOMER_05 = "de561f7a-25d9-480a-bf5a-cb4378243ba2";
const CUSTOMER_02_USER_ID = "f649419d-2423-477b-acb4-bf137b5f4675";

// The trading day that was already in phase 'initiated' when this script
// was written (id 461bdbdf..., trade_date 2026-08-19) — Cycle A picks this
// up and finishes it. If this script is ever re-run, open_shop/close_shop
// below will simply fail loudly (P0007/P0002) rather than silently
// re-running against the wrong day, since `select ... where phase <>
// 'closed'` only ever matches one row at a time.
const CYCLE_A_DAY_ID = "461bdbdf-d3f9-417b-9335-10899925c94e";
const CYCLE_B_TRADE_DATE = "2026-08-20";

async function rpc<T = unknown>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}(${JSON.stringify(args)}) failed: ${error.message}`);
  console.log(`  rpc ${name} ok`);
  return data as T;
}

async function fetchOne<T>(client: SupabaseClient, table: string, match: Record<string, unknown>): Promise<T> {
  let query = client.from(table).select("*");
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { data, error } = await query.single();
  if (error) throw new Error(`fetch ${table} ${JSON.stringify(match)} failed: ${error.message}`);
  return data as T;
}

async function fetchMany<T>(client: SupabaseClient, table: string, match: Record<string, unknown>): Promise<T[]> {
  let query = client.from(table).select("*");
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { data, error } = await query;
  if (error) throw new Error(`fetch ${table} ${JSON.stringify(match)} failed: ${error.message}`);
  return data as T[];
}

interface Company {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
}

interface Profile {
  user_id: string;
  display_name: string;
  role: "backoffice" | "grower" | "customer";
  company_id: string;
}

interface DailyPick {
  id: string;
}

interface DailyPickProduct {
  id: string;
  product_variety_id: string;
}

// save_product's p_customer_pallet_caps shape, confirmed against
// 0007_reference-data-functions.sql's own jsonb_array_elements extraction
// (`elem ->> 'customerCompanyId'` / `'palletCap'`) — camelCase keys inside
// the jsonb, not snake_case.
interface CustomerPalletCap {
  customerCompanyId: string;
  palletCap: number;
}

async function saveProduct(
  client: SupabaseClient,
  args: {
    familyId: string;
    name: string;
    price?: number | null;
    priceRangeFrom?: number | null;
    priceRangeTo?: number | null;
    priceType?: string | null;
    customerPalletCaps?: CustomerPalletCap[];
  },
): Promise<{ id: string }> {
  // Args verbatim from 0007_reference-data-functions.sql's save_product.
  return rpc(client, "save_product", {
    p_id: null,
    p_family_id: args.familyId,
    p_name: args.name,
    p_sizes: null,
    p_pack_type: "pallets",
    p_price: args.price ?? null,
    p_price_range_from: args.priceRangeFrom ?? null,
    p_price_range_to: args.priceRangeTo ?? null,
    p_price_type: args.priceType ?? null,
    p_no_overbooking: 0,
    p_highlight_price_fluctuations: false,
    p_is_seasonal_available: true,
    p_expected_version: null,
    p_customer_pallet_caps: args.customerPalletCaps ?? [],
  });
}

async function saveGrower(
  client: SupabaseClient,
  companyId: string,
  varietyIds: string[],
  transporterCompanyId: string | null,
): Promise<void> {
  const current = await fetchOne<Company>(client, "companies", { id: companyId });
  // Args verbatim from 0033_save-grower-transporter-assignment.sql.
  await rpc(client, "save_grower", {
    p_id: companyId,
    p_name: current.name,
    p_status: current.status,
    p_default_pickup_time: current.default_pickup_time,
    p_whatsapp_group_id: current.whatsapp_group_id,
    p_product_variety_ids: varietyIds,
    p_transporter_company_id: transporterCompanyId,
  });
}

function findLine(lines: DailyPickProduct[], varietyId: string): DailyPickProduct {
  const line = lines.find((l) => l.product_variety_id === varietyId);
  if (!line) throw new Error(`pick line for variety ${varietyId} not found among ${JSON.stringify(lines)}`);
  return line;
}

async function submitOrder(
  client: SupabaseClient,
  tradingDayId: string,
  customerCompanyId: string,
  lines: Array<{ varietyId: string; pallets: number; comment?: string }>,
): Promise<void> {
  // Args verbatim from 0028_customer-order-status-screen.sql's
  // submit_order (backoffice-on-behalf-of path via p_customer_company_id).
  await rpc(client, "submit_order", {
    p_trading_day_id: tradingDayId,
    p_lines: lines.map((l) => ({
      productVarietyId: l.varietyId,
      palletsOrdered: l.pallets,
      comment: l.comment ?? null,
    })),
    p_customer_company_id: customerCompanyId,
  });
}

async function getOrderLine(
  client: SupabaseClient,
  tradingDayId: string,
  customerCompanyId: string,
  varietyId: string,
): Promise<string> {
  const order = await fetchOne<{ id: string }>(client, "daily_orders", {
    trading_day_id: tradingDayId,
    customer_company_id: customerCompanyId,
  });
  const line = await fetchOne<{ id: string }>(client, "daily_order_products", {
    daily_order_id: order.id,
    product_variety_id: varietyId,
  });
  return line.id;
}

async function arrange(
  client: SupabaseClient,
  pickProductId: string,
  orderProductId: string,
  quantity: number,
): Promise<void> {
  // Args verbatim from 0021_arrangement-record-functions.sql.
  await rpc(client, "create_arrangement_record", {
    p_daily_pick_product_id: pickProductId,
    p_daily_order_product_id: orderProductId,
    p_quantity_pallets: quantity,
    p_price: null,
    p_price_type: null,
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

  const summary: Record<string, unknown> = {};

  console.log("\n== Reference data ==");
  // No RPC exists for product_families (confirmed against
  // 0005/0006_reference-data-*.sql — only a backoffice-only RLS policy) —
  // a plain authenticated insert is the only "real" path there is.
  const familyDefs = [
    { name: "כרוב", image_url: "https://picsum.photos/seed/ori-cabbage/300" },
    { name: "עגבניות", image_url: "https://picsum.photos/seed/ori-tomato/300" },
    { name: "מלון", image_url: "https://picsum.photos/seed/ori-melon/300" },
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
  summary.familyIds = familyIds;

  // Indexing a Record<string, string> yields `string | undefined` under
  // noUncheckedIndexedAccess, and passing that straight into saveProduct was
  // failing `pnpm typecheck` for the whole repo. Reading through this helper
  // both satisfies the compiler and turns a mistyped family name into an
  // immediate, named error instead of an insert with an undefined family id.
  function familyId(name: string): string {
    const id = familyIds[name];
    if (!id) throw new Error(`seed bug: no product family was created for "${name}"`);
    return id;
  }

  const cabbage = await saveProduct(client, { familyId: familyId("כרוב"), name: "כרוב לבן", price: 8 });
  const tomatoTamar = await saveProduct(client, {
    familyId: familyId("עגבניות"),
    name: "עגבנית תמר",
    price: 12,
    customerPalletCaps: [{ customerCompanyId: CUSTOMER_01, palletCap: 6 }],
  });
  const tomatoCluster = await saveProduct(client, { familyId: familyId("עגבניות"), name: "עגבנית אשכולות", price: 15 });
  const melon = await saveProduct(client, {
    familyId: familyId("מלון"),
    name: "מלון גליה",
    priceRangeFrom: 10,
    priceRangeTo: 14,
    priceType: "לפי גודל",
  });
  console.log("  varieties:", {
    cabbage: cabbage.id,
    tomatoTamar: tomatoTamar.id,
    tomatoCluster: tomatoCluster.id,
    melon: melon.id,
  });
  summary.varietyIds = {
    cabbage: cabbage.id,
    tomatoTamar: tomatoTamar.id,
    tomatoCluster: tomatoCluster.id,
    melon: melon.id,
  };

  const transporter = await rpc<Company>(client, "save_transporter", {
    p_id: null,
    p_name: "הובלות טסט",
    p_status: "active",
    p_whatsapp_group_id: null,
  });
  console.log(`  transporter -> ${transporter.id}`);
  summary.transporterId = transporter.id;

  await saveGrower(client, GROWER_01, [cabbage.id, tomatoTamar.id], transporter.id);
  await saveGrower(client, GROWER_02, [tomatoCluster.id, melon.id], transporter.id);
  await saveGrower(client, GROWER_03, [cabbage.id, melon.id], null);
  console.log("  assigned grower_products (Grower 01/02/03) + transporter (01/02)");

  const customer02Profile = await fetchOne<Profile>(client, "profiles", { user_id: CUSTOMER_02_USER_ID });
  // Args verbatim from 0007_reference-data-functions.sql's save_user.
  await rpc(client, "save_user", {
    p_user_id: customer02Profile.user_id,
    p_display_name: customer02Profile.display_name,
    p_role: customer02Profile.role,
    p_company_id: customer02Profile.company_id,
    p_blocked_product_variety_ids: [cabbage.id],
  });
  console.log("  blocked כרוב לבן for Customer 02 (profile_blocked_products)");

  console.log("\n== Cycle A: finishing the already-open day ==");
  const pickG1 = await rpc<DailyPick>(client, "bootstrap_grower_pick", {
    p_trading_day_id: CYCLE_A_DAY_ID,
    p_grower_company_id: GROWER_01,
  });
  const pickG2 = await rpc<DailyPick>(client, "bootstrap_grower_pick", {
    p_trading_day_id: CYCLE_A_DAY_ID,
    p_grower_company_id: GROWER_02,
  });
  const pickG3 = await rpc<DailyPick>(client, "bootstrap_grower_pick", {
    p_trading_day_id: CYCLE_A_DAY_ID,
    p_grower_company_id: GROWER_03,
  });

  const linesG1 = await fetchMany<DailyPickProduct>(client, "daily_pick_products", { daily_pick_id: pickG1.id });
  const linesG2 = await fetchMany<DailyPickProduct>(client, "daily_pick_products", { daily_pick_id: pickG2.id });
  const linesG3 = await fetchMany<DailyPickProduct>(client, "daily_pick_products", { daily_pick_id: pickG3.id });

  const g1Cabbage = findLine(linesG1, cabbage.id);
  const g1Tamar = findLine(linesG1, tomatoTamar.id);
  const g2Cluster = findLine(linesG2, tomatoCluster.id);
  const g2Melon = findLine(linesG2, melon.id);
  const g3Cabbage = findLine(linesG3, cabbage.id);
  const g3Melon = findLine(linesG3, melon.id);

  await rpc(client, "send_pick_reminder", { p_daily_pick_id: pickG3.id });

  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g1Cabbage.id, p_pallets_picked: 20 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g1Tamar.id, p_pallets_picked: 15 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g2Cluster.id, p_pallets_picked: 18 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g2Melon.id, p_pallets_picked: 10 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g3Cabbage.id, p_pallets_picked: 12 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g3Melon.id, p_pallets_picked: 8 });

  await rpc(client, "submit_pick", { p_daily_pick_id: pickG1.id });
  await rpc(client, "submit_pick", { p_daily_pick_id: pickG2.id });
  await rpc(client, "submit_pick", { p_daily_pick_id: pickG3.id });

  await rpc(client, "open_shop", { p_can_see_prices: true });

  const orderC5 = await fetchOne<{ id: string }>(client, "daily_orders", {
    trading_day_id: CYCLE_A_DAY_ID,
    customer_company_id: CUSTOMER_05,
  });
  await rpc(client, "send_order_reminder", { p_daily_order_id: orderC5.id });

  await submitOrder(client, CYCLE_A_DAY_ID, CUSTOMER_01, [
    { varietyId: cabbage.id, pallets: 6, comment: "משלוח בבוקר בבקשה" },
    { varietyId: tomatoTamar.id, pallets: 4 },
  ]);
  await submitOrder(client, CYCLE_A_DAY_ID, CUSTOMER_02, [
    { varietyId: tomatoCluster.id, pallets: 10 },
    { varietyId: melon.id, pallets: 3 },
  ]);
  await submitOrder(client, CYCLE_A_DAY_ID, CUSTOMER_03, [
    { varietyId: cabbage.id, pallets: 5 },
    { varietyId: melon.id, pallets: 6 },
  ]);
  await submitOrder(client, CYCLE_A_DAY_ID, CUSTOMER_04, [{ varietyId: tomatoTamar.id, pallets: 3 }]);
  console.log("  submitted orders for Customer 01-04 (Customer 05 left as a reminded, un-submitted draft)");

  const c1CabbageOrder = await getOrderLine(client, CYCLE_A_DAY_ID, CUSTOMER_01, cabbage.id);
  const c1TamarOrder = await getOrderLine(client, CYCLE_A_DAY_ID, CUSTOMER_01, tomatoTamar.id);
  const c2ClusterOrder = await getOrderLine(client, CYCLE_A_DAY_ID, CUSTOMER_02, tomatoCluster.id);
  const c2MelonOrder = await getOrderLine(client, CYCLE_A_DAY_ID, CUSTOMER_02, melon.id);
  const c3CabbageOrder = await getOrderLine(client, CYCLE_A_DAY_ID, CUSTOMER_03, cabbage.id);
  const c3MelonOrder = await getOrderLine(client, CYCLE_A_DAY_ID, CUSTOMER_03, melon.id);
  const c4TamarOrder = await getOrderLine(client, CYCLE_A_DAY_ID, CUSTOMER_04, tomatoTamar.id);

  await arrange(client, g1Cabbage.id, c1CabbageOrder, 6);
  await arrange(client, g1Cabbage.id, c3CabbageOrder, 5);
  await arrange(client, g1Tamar.id, c1TamarOrder, 4);
  await arrange(client, g1Tamar.id, c4TamarOrder, 3);
  await arrange(client, g2Cluster.id, c2ClusterOrder, 10);
  await arrange(client, g2Melon.id, c2MelonOrder, 3);
  // Deliberate mismatch: Customer 03 ordered 6, only 4 actually arranged —
  // mirrors apps/web/e2e/order-history.spec.ts's own dispute scenario.
  await arrange(client, g3Melon.id, c3MelonOrder, 4);
  console.log("  created arrangement_records (Customer 03's melon line deliberately under-arranged: 6 ordered, 4 arranged)");

  await rpc(client, "close_shop", {});
  await rpc(client, "close_arrangement", {});
  console.log(`  cycle A day ${CYCLE_A_DAY_ID} closed (shop_closed -> closed)`);
  summary.cycleADayId = CYCLE_A_DAY_ID;

  console.log("\n== Cycle B: a fresh, currently-open live day ==");
  const dayB = await rpc<{ id: string }>(client, "initiate_business_day", { p_trade_date: CYCLE_B_TRADE_DATE });
  console.log(`  initiated ${dayB.id} (${CYCLE_B_TRADE_DATE})`);

  const pickG1b = await fetchOne<DailyPick>(client, "daily_picks", {
    trading_day_id: dayB.id,
    grower_company_id: GROWER_01,
  });
  const pickG2b = await fetchOne<DailyPick>(client, "daily_picks", {
    trading_day_id: dayB.id,
    grower_company_id: GROWER_02,
  });
  const pickG3b = await fetchOne<DailyPick>(client, "daily_picks", {
    trading_day_id: dayB.id,
    grower_company_id: GROWER_03,
  });

  const linesG1b = await fetchMany<DailyPickProduct>(client, "daily_pick_products", { daily_pick_id: pickG1b.id });
  const linesG2b = await fetchMany<DailyPickProduct>(client, "daily_pick_products", { daily_pick_id: pickG2b.id });
  const linesG3b = await fetchMany<DailyPickProduct>(client, "daily_pick_products", { daily_pick_id: pickG3b.id });

  await rpc(client, "update_pick_product_pallets", {
    p_daily_pick_product_id: findLine(linesG1b, cabbage.id).id,
    p_pallets_picked: 10,
  });
  await rpc(client, "update_pick_product_pallets", {
    p_daily_pick_product_id: findLine(linesG1b, tomatoTamar.id).id,
    p_pallets_picked: 8,
  });
  await rpc(client, "update_pick_product_pallets", {
    p_daily_pick_product_id: findLine(linesG2b, tomatoCluster.id).id,
    p_pallets_picked: 12,
  });
  await rpc(client, "update_pick_product_pallets", {
    p_daily_pick_product_id: findLine(linesG2b, melon.id).id,
    p_pallets_picked: 6,
  });
  await rpc(client, "update_pick_product_pallets", {
    p_daily_pick_product_id: findLine(linesG3b, cabbage.id).id,
    p_pallets_picked: 5,
  });
  await rpc(client, "update_pick_product_pallets", {
    p_daily_pick_product_id: findLine(linesG3b, melon.id).id,
    p_pallets_picked: 4,
  });

  await rpc(client, "submit_pick", { p_daily_pick_id: pickG1b.id });
  await rpc(client, "submit_pick", { p_daily_pick_id: pickG2b.id });
  console.log("  Grower 03's cycle-B pick left in draft (in-progress grower workflow)");

  await rpc(client, "open_shop", { p_can_see_prices: true });

  await submitOrder(client, dayB.id, CUSTOMER_02, [{ varietyId: tomatoCluster.id, pallets: 4 }]);
  console.log("  Customer 02 submitted (\"נשלח\"); Customer 01 left as an untouched open draft (\"חדש\")");
  // Cycle B is deliberately left at shop_open — never closed — so it's
  // the live, currently-orderable day the customer screens read.
  summary.cycleBDayId = dayB.id;

  console.log("\n== Done ==");
  console.log(JSON.stringify(summary, null, 2));
}

void main();
