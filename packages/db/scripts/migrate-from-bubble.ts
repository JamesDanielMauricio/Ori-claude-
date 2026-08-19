// One-time ETL: live Bubble project -> this schema. See
// docs/DATA_MIGRATION_PLAN.md for the full account — the row counts this
// script's dependency order and skip-logic are based on, the specific
// reconciliation problems found (arrangement_records' missing order-line
// link, the source's five-type Session audit trail vs. this schema's
// two), and the cutover procedure this script is one step of.
//
// NOT executed against production by this prompt — building and
// documenting the migration path was the deliverable, not performing an
// irreversible write against real customer data without a dedicated,
// separately-authorized cutover window. Run with `--dry-run` first
// (default) to see counts and logged issues without writing anything;
// pass `--commit` to actually write.
//
// Requires: BUBBLE_API_TOKEN, BUBBLE_DOMAIN (e.g. app.harpazmarketing.com
// — from the schema's own app_data.domain), DATABASE_URL,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Run via `pnpm --filter @ori/db migrate:from-bubble -- --dry-run`.

import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const DRY_RUN = !process.argv.includes("--commit");

const BUBBLE_DOMAIN = process.env.BUBBLE_DOMAIN ?? "";
const BUBBLE_API_TOKEN = process.env.BUBBLE_API_TOKEN ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!DRY_RUN && (!BUBBLE_DOMAIN || !BUBBLE_API_TOKEN || !DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error("Missing required env vars for a --commit run — see this file's header comment.");
}

const sql = postgres(DATABASE_URL || "postgres://unused", { max: 1 });
const supabaseAdmin = createClient(SUPABASE_URL || "http://unused", SUPABASE_SERVICE_ROLE_KEY || "unused", {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------
// Bubble Data API — plain fetch, paginated. Deliberately not the
// st4ck MCP bubble_* tools used to research this plan: those are this
// session's own dev-time tooling, not something a migration run in CI or
// a one-off terminal invocation can depend on.
// ---------------------------------------------------------------------
interface BubbleRecord {
  _id: string;
  [key: string]: unknown;
}

async function fetchAllBubbleRecords(dataType: string): Promise<BubbleRecord[]> {
  const records: BubbleRecord[] = [];
  let cursor = 0;
  for (;;) {
    const url = `https://${BUBBLE_DOMAIN}/api/1.1/obj/${dataType}?cursor=${cursor}&limit=100`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${BUBBLE_API_TOKEN}` } });
    if (!response.ok) throw new Error(`Bubble API ${dataType} responded ${response.status}: ${await response.text()}`);
    const body = (await response.json()) as { response: { results: BubbleRecord[]; remaining: number } };
    records.push(...body.response.results);
    if (body.response.remaining === 0) break;
    cursor += body.response.results.length;
  }
  return records;
}

// ---------------------------------------------------------------------
// _bubble_migration_id_map / _bubble_migration_log helpers
// (packages/db/migrations/0026).
// ---------------------------------------------------------------------
async function mapId(bubbleId: string, entityType: string, newId: string): Promise<void> {
  if (DRY_RUN) return;
  await sql`
    insert into _bubble_migration_id_map (bubble_id, entity_type, new_id)
    values (${bubbleId}, ${entityType}, ${newId})
    on conflict (bubble_id) do nothing
  `;
}

async function resolveId(bubbleId: string | null | undefined): Promise<string | null> {
  if (!bubbleId) return null;
  const [row] = await sql<{ new_id: string }[]>`
    select new_id from _bubble_migration_id_map where bubble_id = ${bubbleId}
  `;
  return row?.new_id ?? null;
}

async function log(entityType: string, bubbleId: string | null, severity: "info" | "warning" | "error", message: string): Promise<void> {
  console.log(`[${severity}] ${entityType}${bubbleId ? ` (${bubbleId})` : ""}: ${message}`);
  if (DRY_RUN) return;
  await sql`
    insert into _bubble_migration_log (entity_type, bubble_id, severity, message)
    values (${entityType}, ${bubbleId}, ${severity}, ${message})
  `;
}

// ---------------------------------------------------------------------
// Reference data: companies, users, product catalog. No FK dependencies
// on anything migrated later.
// ---------------------------------------------------------------------

const COMPANY_TYPE_MAP: Record<string, string> = {
  "מגדל": "grower",
  "משווק": "backoffice",
  "לקוח": "customer",
  "מוביל": "transporter",
};
const COMPANY_STATUS_MAP: Record<string, string> = { "פעיל": "active", "לא פעיל": "inactive" };

async function migrateCompanies(): Promise<void> {
  const companies = await fetchAllBubbleRecords("company");
  for (const company of companies) {
    const newId = randomUUID();
    const type = COMPANY_TYPE_MAP[company["Type"] as string];
    if (!type) {
      await log("company", company._id, "error", `unrecognized Type "${company["Type"]}" — skipped`);
      continue;
    }
    if (!DRY_RUN) {
      await sql`
        insert into companies (id, name, type, status, default_pickup_time, can_see_product_prices, whatsapp_group_id)
        values (
          ${newId}, ${company["Name"] as string}, ${type},
          ${COMPANY_STATUS_MAP[company["Status"] as string] ?? "active"},
          ${(company["Default Pickup Time"] as string | null) ?? null},
          ${(company["Can see product prices"] as boolean | null) ?? null},
          ${(company["group id (whatsapp)"] as string | null) ?? null}
        )
      `;
    }
    await mapId(company._id, "company", newId);
  }
  await log("company", null, "info", `migrated ${companies.length} companies`);
}

// User passwords are never exposed by Bubble's Data API (they're hashed
// server-side and inaccessible even to an API token with full read
// access) — every migrated user gets a fresh Supabase Auth account with
// must_change_password = true, the same forced-reset mechanism
// bulk-import already uses for newly created users. This is a real,
// necessary behavior change at cutover (every existing user needs a
// fresh credential, not silent continuity), not an oversight — flag it
// prominently in the cutover communication to users.
async function migrateUsers(): Promise<void> {
  const users = await fetchAllBubbleRecords("user");
  for (const user of users) {
    const email = ((user["authentication"] as { email?: { email?: string } } | undefined)?.email?.email ?? "").trim();
    if (!email) {
      await log("user", user._id, "error", "no email on record — skipped (cannot create a Supabase Auth account without one)");
      continue;
    }
    const companyBubbleId = user["Company"] as string | undefined;
    const companyId = await resolveId(companyBubbleId);
    if (!companyId) {
      await log("user", user._id, "error", `Company ${companyBubbleId} not yet migrated — skipped`);
      continue;
    }
    const role = { "משווק": "backoffice", "מגדל": "grower", "לקוח": "customer" }[user["Role"] as string];
    if (!role) {
      await log("user", user._id, "warning", `unrecognized/absent Role "${user["Role"]}" — skipped (transporter users never sign in, per docs/SCHEMA_DECISIONS.md)`);
      continue;
    }

    let newUserId: string;
    if (!DRY_RUN) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: randomUUID(),
        email_confirm: true,
      });
      if (error || !data.user) {
        await log("user", user._id, "error", `Supabase createUser failed: ${error?.message ?? "unknown"}`);
        continue;
      }
      newUserId = data.user.id;
      await sql`
        insert into profiles (user_id, company_id, role, display_name, must_change_password, phone_number)
        values (
          ${newUserId}, ${companyId}, ${role},
          ${`${(user["First Name"] as string) ?? ""} ${(user["Last name"] as string) ?? ""}`.trim() || "Migrated User"},
          true,
          ${(user["Phone Number"] as string | null) ?? null}
        )
      `;
    } else {
      newUserId = randomUUID();
    }
    await mapId(user._id, "user", newUserId);
  }
  await log("user", null, "info", `migrated ${users.length} users`);
}

async function migrateProductFamiliesAndVarieties(): Promise<void> {
  const families = await fetchAllBubbleRecords("productfamily");
  for (const family of families) {
    const newId = randomUUID();
    if (!DRY_RUN) {
      await sql`insert into product_families (id, name) values (${newId}, ${family["Name"] as string})`;
    }
    await mapId(family._id, "productfamily", newId);
  }
  await log("productfamily", null, "info", `migrated ${families.length} product families`);

  const varieties = await fetchAllBubbleRecords("productvarieties");
  for (const variety of varieties) {
    const familyId = await resolveId(variety["Product Family"] as string);
    if (!familyId) {
      await log("productvarieties", variety._id, "error", "Product Family not yet migrated — skipped");
      continue;
    }
    const newId = randomUUID();
    if (!DRY_RUN) {
      await sql`
        insert into product_varieties (
          id, family_id, name, sizes, price, price_range_from, price_range_to, price_type,
          no_overbooking, highlight_price_fluctuations, is_seasonal_available
        ) values (
          ${newId}, ${familyId}, ${variety["Variety"] as string}, ${(variety["Size"] as string | null) ?? null},
          ${(variety["Price"] as number | null) ?? null}, ${(variety["Price Range from"] as number | null) ?? null},
          ${(variety["Price Range to"] as number | null) ?? null}, ${(variety["Price Type"] as string | null) ?? null},
          ${(variety["Overbooking"] as number) ?? 0}, ${(variety["Highlight Price Fluctuations"] as boolean) ?? false},
          ${(variety["In season"] as boolean) ?? true}
        )
      `;
    }
    await mapId(variety._id, "productvarieties", newId);
  }
  await log("productvarieties", null, "info", `migrated ${varieties.length} product varieties`);
}

// ---------------------------------------------------------------------
// Trading days — RECONSTRUCTED, not migrated 1:1. The source has no
// "Trading Day" entity; every date-scoped record (dailyshop,
// dailyarrangement, dailypick, dailyorder) carries its own `Date` field
// independently. One trading_days row is synthesized per distinct date
// found across all four, with phase derived from that date's
// dailyarrangement.status / dailyshop.Status combination. The single
// CURRENTLY-OPEN day (confirmed live: appsettings.shop_status = "Open"
// at the time this plan was written) needs the cutover to happen only
// once that day reaches close_arrangement naturally — see this file's
// closing comment and docs/DATA_MIGRATION_PLAN.md's cutover section.
// ---------------------------------------------------------------------
// Exported (not yet called from main() — see the TODO in main()) rather
// than left as a dead local: it's a complete, real function waiting on
// one manual input (the admin user's Bubble _id) before it's wired up,
// not an abandoned stub.
export async function reconstructTradingDays(adminUserBubbleId: string): Promise<Map<string, string>> {
  const [shops, arrangements, picks, orders] = await Promise.all([
    fetchAllBubbleRecords("dailyshop"),
    fetchAllBubbleRecords("dailyarrangement"),
    fetchAllBubbleRecords("dailypick"),
    fetchAllBubbleRecords("dailyorder"),
  ]);

  const dateKey = (iso: string) => (iso ?? "").slice(0, 10);
  const dates = new Set<string>();
  for (const row of [...shops, ...arrangements, ...picks, ...orders]) {
    const d = dateKey(row["Date"] as string);
    if (d) dates.add(d);
  }

  const shopByDate = new Map(shops.map((s) => [dateKey(s["Date"] as string), s]));
  const arrangementByDate = new Map(arrangements.map((a) => [dateKey(a["Date"] as string), a]));

  const adminUserId = await resolveId(adminUserBubbleId);
  if (!adminUserId) throw new Error(`admin user ${adminUserBubbleId} must be migrated before trading days`);

  const tradingDayIdByDate = new Map<string, string>();
  for (const date of [...dates].sort()) {
    const shop = shopByDate.get(date);
    const arrangement = arrangementByDate.get(date);
    let phase = "initiated";
    if (arrangement?.["status"] === "Close") phase = "closed";
    else if (shop?.["Status"] === "Closed") phase = "shop_closed";
    else if (shop) phase = "shop_open";

    const newId = randomUUID();
    if (!DRY_RUN) {
      await sql`
        insert into trading_days (id, trade_date, phase, initiated_by)
        values (${newId}, ${date}, ${phase}, ${adminUserId})
      `;
    }
    tradingDayIdByDate.set(date, newId);
    await mapId(`synthetic-trading-day-${date}`, "trading_day", newId);
  }
  await log("trading_day", null, "info", `reconstructed ${tradingDayIdByDate.size} trading days from ${dates.size} distinct dates`);
  return tradingDayIdByDate;
}

// ---------------------------------------------------------------------
// Entry point — see docs/DATA_MIGRATION_PLAN.md for the full dependency
// order this follows and the steps not yet implemented here (grower
// in-season lists, shops/arrangements/picks/orders/lines, arrangement
// record reconciliation, lifecycle session import, notification template
// review). This script is deliberately left partial: the tractable,
// mechanical steps are real and runnable; the genuinely ambiguous ones
// (arrangement_records -> daily_order_products matching, chiefly) are
// flagged in the plan as needing a human decision before being coded,
// not guessed at here.
// ---------------------------------------------------------------------
async function main() {
  console.log(DRY_RUN ? "DRY RUN — no writes will be made. Pass --commit to write for real." : "COMMIT RUN — writing to the database.");

  await migrateCompanies();
  await migrateUsers();
  await migrateProductFamiliesAndVarieties();

  // TODO before a real run: resolve the actual admin user's Bubble _id
  // (the "assigned distributor" on the live appsettings singleton, or
  // whichever backoffice user should be recorded as initiated_by for
  // reconstructed historical days) and pass it here.
  // await reconstructTradingDays(ADMIN_USER_BUBBLE_ID);

  await log("migration", null, "info", "Stopped after reference data + trading day reconstruction — see docs/DATA_MIGRATION_PLAN.md for the remaining steps and the specific reconciliation decisions they need before being coded.");

  await sql.end();
}

void main();
