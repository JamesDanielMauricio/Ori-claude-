// One-shot ops script, follow-up to seed-sample-data.ts. Run manually with
// `npx tsx scripts/seed-more-sample-data.ts` from packages/db, with the
// root .env sourced. Not part of the shipped app.
//
// seed-sample-data.ts already ran once (its Cycle A day is closed, its
// Cycle B day is d0ee25c2..., trade_date 2026-08-20, left at shop_open with
// only one customer order submitted). Since then more demo companies
// (Customer 06-10, Grower 04-10) showed up in the project from other
// testing, and — more importantly — today's real date moved on to
// 2026-09-08, so "the current trading day" being stuck three weeks in the
// past no longer reads as current. This script:
//
//   - Finishes 2026-08-20 into a SECOND full closed historical day: submits
//     the rest of the customer orders and Grower 03's still-draft pick,
//     arranges every line (one deliberate ordered-vs-arranged mismatch on
//     Customer 07's cabbage line, same dispute pattern as Cycle A), then
//     closes shop and arrangement. Customer 10 is deliberately left as a
//     reminded-but-never-submitted no-show.
//   - Opens a BRAND NEW trading day dated today (2026-09-08) and builds it
//     up to a busy shop_open state — several customers with multi-line
//     submitted orders (including one variety, עגבנית תמר, deliberately
//     driven to exactly sold-out, supply == demand, to exercise the
//     out-of-stock badge), one grower (03) deliberately left picking
//     (draft, reminded), two customers deliberately left untouched (one
//     reminded, one not) — and then leaves it there, unclosed and
//     unarranged, so the arrange/close-shop/close-arrangement flow is
//     something to click through live in the app rather than something
//     already done for you.
//
// All IDs below were read directly off the hosted project (see the
// conversation's inspect-*.ts scratch queries), not guessed. Bypasses
// @ori/domain the same way seed-sample-data.ts does, for the same reason.
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

// Existing companies (see seed-sample-data.ts for 01-05/growers; 06-10 were
// created by other testing since and are reused here, not created).
const GROWER_01 = "292c4d5e-b2a7-4994-83cf-db937d38029e";
const GROWER_02 = "a765356d-2501-4fd8-bbe8-e7590caae862";
const GROWER_03 = "d696a600-e1a0-40cc-9479-902f9c24895c";
const CUSTOMER_01 = "77023710-32b5-4e76-88db-0ec09d0f90b1";
const CUSTOMER_02 = "c43f19d4-04f4-4b3e-a9b5-b345270a9ced";
const CUSTOMER_03 = "83f84064-cbea-4612-a295-d88b18420581";
const CUSTOMER_04 = "6b0420a2-a65d-4330-bdc3-312fe2adba8a";
const CUSTOMER_05 = "de561f7a-25d9-480a-bf5a-cb4378243ba2";
const CUSTOMER_06 = "fd57e27b-df56-49c2-8fb1-322f1493895f";
const CUSTOMER_07 = "d0f4513e-0841-4d8d-8225-a2da89ecce41";
const CUSTOMER_08 = "ab07891a-1d70-4179-8629-c99c36f19c53";
const CUSTOMER_09 = "6d738d9a-43d7-44f4-ac51-36d75fc08e5d";
const CUSTOMER_10 = "5e3b8411-eb4c-433e-84ef-2b2df6dfccd6";

// Existing product varieties (created by seed-sample-data.ts).
const CABBAGE = "475d8c75-026c-494b-ad6a-ce07a574045c"; // כרוב לבן
const TAMAR = "95dd4d2e-fa1c-4743-a112-286d4e8f385f"; // עגבנית תמר (Customer 01's pallet cap: 6)
const CLUSTER = "615074ea-ebd4-49d7-9b4a-ca9c2ce5d013"; // עגבנית אשכולות
const MELON = "9b842116-dd28-4590-bb59-e4b71caa8ac5"; // מלון גליה

// The stale Cycle B day left open by seed-sample-data.ts.
const STALE_DAY_ID = "d0ee25c2-f4f7-4d24-8a80-551080d149af";
const STALE_DAY_PICKS = {
  g1: { pickId: "c17f9475-d683-406f-9c98-49209ddec6e7", cabbage: "f056e3a4-2e36-44b2-9683-76f7725a440a", tamar: "f967a598-68ba-45ab-9878-4269973e9c05" },
  g2: { pickId: "9d24ddd3-98ac-45c3-a530-da7131bfaff0", cluster: "8758fc0b-bb0f-4869-bee1-87d513c49436", melon: "10a2cf9c-f357-4ac0-bc42-c1c0c5f99761" },
  g3: { pickId: "a3483983-5b7a-4f35-b53a-2f061ae8cf86", cabbage: "531c9cf7-b667-48fd-b3fc-41dd93c7a15e", melon: "59d2a9ff-58be-4066-9e51-8c449c5a227e" },
};
const STALE_DAY_ORDERS: Record<string, string> = {
  [CUSTOMER_01]: "a2f4030d-d5b1-430c-84e6-e67fb0d16786",
  [CUSTOMER_02]: "65848621-8539-4a3c-a1c9-5d93f07ea23d", // already submitted (cluster: 4)
  [CUSTOMER_03]: "1e9f6aa5-56a1-43e1-9785-9b93c30dc771",
  [CUSTOMER_04]: "50b70bb1-d410-4d42-a550-1e5717f58257",
  [CUSTOMER_05]: "9cc80a47-7d4d-40e7-a93f-c626c84dfbec",
  [CUSTOMER_06]: "ba6cc265-c7dc-43d4-9f0d-7452af3b1dc9",
  [CUSTOMER_07]: "26d86ada-72c4-4e0d-8201-41b7c8f23a66",
  [CUSTOMER_08]: "29e03785-1d10-4b84-9817-e5ba00eeab8d",
  [CUSTOMER_09]: "f14a57d7-54b4-4324-b3ad-5abcb73ad4b4",
  [CUSTOMER_10]: "d53b67e2-04a8-4cfa-acc0-5437fbd3a525", // left as a reminded no-show
};

const TODAY_TRADE_DATE = "2026-09-08";

async function rpc<T = unknown>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
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

interface DailyOrderProductLine {
  id: string;
}

async function submitOrder(
  client: SupabaseClient,
  tradingDayId: string,
  customerCompanyId: string,
  lines: Array<{ varietyId: string; pallets: number; comment?: string }>,
): Promise<void> {
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

async function orderLine(client: SupabaseClient, dailyOrderId: string, varietyId: string): Promise<string> {
  const line = await fetchOne<DailyOrderProductLine>(client, "daily_order_products", {
    daily_order_id: dailyOrderId,
    product_variety_id: varietyId,
  });
  return line.id;
}

async function arrange(client: SupabaseClient, pickProductId: string, orderProductId: string, quantity: number): Promise<void> {
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

  console.log("\n== Finishing the stale 2026-08-20 day into a second closed history ==");

  await rpc(client, "send_pick_reminder", { p_daily_pick_id: STALE_DAY_PICKS.g3.pickId });
  await rpc(client, "submit_pick", { p_daily_pick_id: STALE_DAY_PICKS.g3.pickId });

  await submitOrder(client, STALE_DAY_ID, CUSTOMER_01, [
    { varietyId: CABBAGE, pallets: 4 },
    { varietyId: TAMAR, pallets: 3, comment: "משלוח בבוקר בבקשה" },
  ]);
  await submitOrder(client, STALE_DAY_ID, CUSTOMER_03, [
    { varietyId: CABBAGE, pallets: 3 },
    { varietyId: MELON, pallets: 2 },
  ]);
  await submitOrder(client, STALE_DAY_ID, CUSTOMER_04, [
    { varietyId: TAMAR, pallets: 2 },
    { varietyId: CLUSTER, pallets: 3 },
  ]);
  await submitOrder(client, STALE_DAY_ID, CUSTOMER_05, [
    { varietyId: CABBAGE, pallets: 2 },
    { varietyId: MELON, pallets: 3 },
  ]);
  await submitOrder(client, STALE_DAY_ID, CUSTOMER_06, [
    { varietyId: TAMAR, pallets: 1 },
    { varietyId: CLUSTER, pallets: 2 },
  ]);
  await submitOrder(client, STALE_DAY_ID, CUSTOMER_07, [
    { varietyId: CABBAGE, pallets: 2 },
    { varietyId: MELON, pallets: 2 },
  ]);
  await submitOrder(client, STALE_DAY_ID, CUSTOMER_08, [
    { varietyId: CABBAGE, pallets: 2 },
    { varietyId: CLUSTER, pallets: 1 },
  ]);
  await submitOrder(client, STALE_DAY_ID, CUSTOMER_09, [
    { varietyId: TAMAR, pallets: 1 },
    { varietyId: MELON, pallets: 1 },
  ]);
  await rpc(client, "send_order_reminder", { p_daily_order_id: STALE_DAY_ORDERS[CUSTOMER_10] });
  console.log("  submitted orders for Customer 01/03-09 (Customer 02 already was; Customer 10 left as a reminded no-show)");

  const c01Cabbage = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_01]!, CABBAGE);
  const c01Tamar = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_01]!, TAMAR);
  const c02Cluster = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_02]!, CLUSTER);
  const c03Cabbage = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_03]!, CABBAGE);
  const c03Melon = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_03]!, MELON);
  const c04Tamar = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_04]!, TAMAR);
  const c04Cluster = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_04]!, CLUSTER);
  const c05Cabbage = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_05]!, CABBAGE);
  const c05Melon = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_05]!, MELON);
  const c06Tamar = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_06]!, TAMAR);
  const c06Cluster = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_06]!, CLUSTER);
  const c07Cabbage = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_07]!, CABBAGE);
  const c07Melon = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_07]!, MELON);
  const c08Cabbage = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_08]!, CABBAGE);
  const c08Cluster = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_08]!, CLUSTER);
  const c09Tamar = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_09]!, TAMAR);
  const c09Melon = await orderLine(client, STALE_DAY_ORDERS[CUSTOMER_09]!, MELON);

  await arrange(client, STALE_DAY_PICKS.g1.cabbage, c01Cabbage, 4);
  await arrange(client, STALE_DAY_PICKS.g1.cabbage, c03Cabbage, 3);
  await arrange(client, STALE_DAY_PICKS.g1.cabbage, c05Cabbage, 2);
  // Deliberate mismatch: Customer 07 ordered 2 pallets of cabbage, only 1 was left to arrange.
  await arrange(client, STALE_DAY_PICKS.g3.cabbage, c07Cabbage, 1);
  await arrange(client, STALE_DAY_PICKS.g3.cabbage, c08Cabbage, 2);
  await arrange(client, STALE_DAY_PICKS.g1.tamar, c01Tamar, 3);
  await arrange(client, STALE_DAY_PICKS.g1.tamar, c04Tamar, 2);
  await arrange(client, STALE_DAY_PICKS.g1.tamar, c06Tamar, 1);
  await arrange(client, STALE_DAY_PICKS.g1.tamar, c09Tamar, 1);
  await arrange(client, STALE_DAY_PICKS.g2.cluster, c02Cluster, 4);
  await arrange(client, STALE_DAY_PICKS.g2.cluster, c04Cluster, 3);
  await arrange(client, STALE_DAY_PICKS.g2.cluster, c06Cluster, 2);
  await arrange(client, STALE_DAY_PICKS.g2.cluster, c08Cluster, 1);
  await arrange(client, STALE_DAY_PICKS.g2.melon, c03Melon, 2);
  await arrange(client, STALE_DAY_PICKS.g2.melon, c05Melon, 3);
  await arrange(client, STALE_DAY_PICKS.g3.melon, c07Melon, 2);
  await arrange(client, STALE_DAY_PICKS.g3.melon, c09Melon, 1);
  console.log("  arranged every line (Customer 07's cabbage line deliberately short: 2 ordered, 1 arranged)");

  await rpc(client, "close_shop", {});
  await rpc(client, "close_arrangement", {});
  console.log(`  ${STALE_DAY_ID} (2026-08-20) closed`);

  console.log("\n== Opening today's trading day (2026-09-08) as the live day ==");
  const today = await rpc<{ id: string }>(client, "initiate_business_day", { p_trade_date: TODAY_TRADE_DATE });
  console.log(`  initiated ${today.id} (${TODAY_TRADE_DATE})`);

  const pickG1 = await fetchOne<{ id: string }>(client, "daily_picks", { trading_day_id: today.id, grower_company_id: GROWER_01 });
  const pickG2 = await fetchOne<{ id: string }>(client, "daily_picks", { trading_day_id: today.id, grower_company_id: GROWER_02 });
  const pickG3 = await fetchOne<{ id: string }>(client, "daily_picks", { trading_day_id: today.id, grower_company_id: GROWER_03 });

  const g1Cabbage = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG1.id, product_variety_id: CABBAGE });
  const g1Tamar = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG1.id, product_variety_id: TAMAR });
  const g2Cluster = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG2.id, product_variety_id: CLUSTER });
  const g2Melon = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG2.id, product_variety_id: MELON });
  const g3Cabbage = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG3.id, product_variety_id: CABBAGE });
  const g3Melon = await fetchOne<{ id: string }>(client, "daily_pick_products", { daily_pick_id: pickG3.id, product_variety_id: MELON });

  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g1Cabbage.id, p_pallets_picked: 25 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g1Tamar.id, p_pallets_picked: 20 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g2Cluster.id, p_pallets_picked: 22 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g2Melon.id, p_pallets_picked: 18 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g3Cabbage.id, p_pallets_picked: 10 });
  await rpc(client, "update_pick_product_pallets", { p_daily_pick_product_id: g3Melon.id, p_pallets_picked: 8 });

  await rpc(client, "submit_pick", { p_daily_pick_id: pickG1.id });
  await rpc(client, "submit_pick", { p_daily_pick_id: pickG2.id });
  await rpc(client, "send_pick_reminder", { p_daily_pick_id: pickG3.id });
  console.log("  Grower 01/02 picks submitted (25/20 and 22/18 pallets); Grower 03 still picking (draft, reminded)");

  await rpc(client, "open_shop", { p_can_see_prices: true });

  // תמר (tamar) is deliberately driven to exactly sold out: 6+5+4+5 = 20
  // ordered against 20 picked, so is_orderable flips to false — the one
  // variety on this live day that should show an out-of-stock badge.
  await submitOrder(client, today.id, CUSTOMER_01, [
    { varietyId: CABBAGE, pallets: 5 },
    { varietyId: TAMAR, pallets: 6, comment: "בבקשה איכות מובחרת" }, // at Customer 01's pallet cap
  ]);
  await submitOrder(client, today.id, CUSTOMER_02, [
    { varietyId: TAMAR, pallets: 5 },
    { varietyId: CLUSTER, pallets: 6 },
  ]);
  await submitOrder(client, today.id, CUSTOMER_03, [
    { varietyId: CABBAGE, pallets: 4 },
    { varietyId: MELON, pallets: 5 },
  ]);
  await submitOrder(client, today.id, CUSTOMER_04, [
    { varietyId: CLUSTER, pallets: 4 },
    { varietyId: MELON, pallets: 4 },
  ]);
  await submitOrder(client, today.id, CUSTOMER_05, [
    { varietyId: TAMAR, pallets: 4 },
    { varietyId: MELON, pallets: 3 },
  ]);
  await submitOrder(client, today.id, CUSTOMER_06, [
    { varietyId: CABBAGE, pallets: 3 },
    { varietyId: CLUSTER, pallets: 3 },
  ]);
  await submitOrder(client, today.id, CUSTOMER_07, [
    { varietyId: TAMAR, pallets: 5 },
    { varietyId: CABBAGE, pallets: 2 },
  ]);
  await submitOrder(client, today.id, CUSTOMER_10, [
    { varietyId: CABBAGE, pallets: 6 },
    { varietyId: CLUSTER, pallets: 3 },
    { varietyId: MELON, pallets: 2 },
  ]);
  const order09 = await fetchOne<{ id: string }>(client, "daily_orders", { trading_day_id: today.id, customer_company_id: CUSTOMER_09 });
  await rpc(client, "send_order_reminder", { p_daily_order_id: order09.id });
  console.log("  Customer 01/02/03/04/05/06/07/10 submitted; Customer 09 reminded but still hasn't ordered; Customer 08 untouched");
  console.log("  day left at shop_open, unarranged — close/arrange this one live in the app");

  console.log("\n== Done ==");
  console.log(JSON.stringify({ closedDayId: STALE_DAY_ID, liveDayId: today.id, liveTradeDate: TODAY_TRADE_DATE }, null, 2));
}

void main();
