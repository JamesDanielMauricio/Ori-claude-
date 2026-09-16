// Step 2 of 2 of the Bubble -> Supabase import (step 1: scripts/bubble-export.ts).
//
// Reads the snapshot bubble-export.ts wrote to packages/db/.bubble-export/<env>/
// and REPLACES this database's business data with it — companies, logins,
// the product catalog, and every trading day with its picks, orders and
// arrangement — in ONE Postgres transaction: either all of it lands, or none
// of it does and the database is left exactly as it was.
//
// Run from packages/db:
//   pnpm import:from-bubble                 dry run (the default): performs every
//                                           delete, insert and check inside the
//                                           transaction, prints the report, then
//                                           rolls everything back
//   pnpm import:from-bubble -- --commit     the real import
//
// Kept, not replaced: notification_templates, notification_settings and
// alert_types — configuration seeded by migrations, not business data.
//
// Logins are the one part that cannot live inside that transaction: Supabase
// Auth only creates accounts through its Admin API, which commits on its own.
// A --commit run creates them just before the transaction and deletes the ones
// it created again if the transaction fails — the same compensation
// packages/domain/src/auth/bulk-create-users.ts uses. Bubble never exposes
// password hashes, so every imported login gets a random password and
// must_change_password = true; people get in through the admin-mediated reset.
//
// A --commit run first writes a JSON backup of everything it is about to
// delete to packages/db/.bubble-export/backups/ (gitignored).
//
// Each rule for turning Bubble records into rows is explained where it is
// applied; docs/DATA_MIGRATION_PLAN.md records the decisions behind them.
// Anything that cannot be imported cleanly is written to
// _bubble_migration_log (migration 0026) and summarised on the console —
// nothing is dropped silently.

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "../../..");

try {
  // Node's own .env parser. Variables already set in the shell win.
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch {
  // No root .env — rely on whatever the shell exported.
}

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const envFlagIndex = args.indexOf("--env");
const BUBBLE_ENV = envFlagIndex === -1 ? "test" : args[envFlagIndex + 1];
if (BUBBLE_ENV !== "test" && BUBBLE_ENV !== "live") {
  throw new Error(`--env must be "test" or "live", got "${BUBBLE_ENV}"`);
}

const EXPORT_DIR = path.resolve(scriptsDir, "..", ".bubble-export", BUBBLE_ENV);
const BACKUP_DIR = path.resolve(scriptsDir, "..", ".bubble-export", "backups");

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set — add it to the root .env.");
if (COMMIT && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error("A --commit run creates logins through the Supabase Admin API: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

// Bubble's "No. of pallets per wholesaler" is the per-customer order cap
// (product_varieties.number_of_orders_per_customer, migration 0042). The new
// app reads a cap of 0 as "this customer may order nothing", and null as "no
// cap". Set from the evidence in Bubble's own order history — see
// docs/DATA_MIGRATION_PLAN.md.
const CAP_ZERO_MEANS_NO_CAP = true;

const BATCH_SIZE = 1000;

// ---------------------------------------------------------------------------
// Bubble records and field readers
// ---------------------------------------------------------------------------

type BubbleRecord = { _id: string } & Record<string, unknown>;
type Row = Record<string, unknown>;

const DATA_TYPES = [
  "company",
  "user",
  "customer",
  "productfamily",
  "productvarieties",
  "dailyshop",
  "dailyshopproduct",
  "dailyarrangement",
  "dailypick",
  "dailypickproduct",
  "dailyorder",
  "dailyorderproducts",
  "dailyarrangementrecords",
  "session",
  "mainalert",
  "alerttypes",
  "alerts",
  "appsettings",
  "dailycheckingofemptyorders",
] as const;
type DataType = (typeof DATA_TYPES)[number];
type ExportData = Record<DataType, BubbleRecord[]>;

// A non-empty string, trimmed — Bubble returns "" and missing keys for the
// same "not set" state.
function text(record: BubbleRecord, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function numberValue(record: BubbleRecord, field: string): number | null {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(record: BubbleRecord, field: string): boolean | null {
  const value = record[field];
  return typeof value === "boolean" ? value : null;
}

// Bubble "list of things" fields come back as arrays of _id strings.
function idList(record: BubbleRecord, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const createdAt = (record: BubbleRecord) => record["Created Date"] as string;
const modifiedAt = (record: BubbleRecord) => text(record, "Modified Date") ?? createdAt(record);
const byCreated = (a: BubbleRecord, b: BubbleRecord) => createdAt(a).localeCompare(createdAt(b));

// Bubble stores every date as a UTC instant. The business runs in Israel, so
// "which trading date" and "what time of day" are read in Asia/Jerusalem:
// slicing the UTC string would put a day that starts at 00:00 Israel time
// (21:00 or 22:00 UTC the evening before) on the previous date.
const ISRAEL_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ISRAEL_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const israelDate = (iso: string) => ISRAEL_DATE.format(new Date(iso));
const israelTime = (iso: string) => ISRAEL_TIME.format(new Date(iso));

// The whole day mapping depends on these two formats; fail loudly on a Node
// build whose ICU data formats them differently.
if (israelDate("2026-04-05T22:00:00.000Z") !== "2026-04-06" || israelTime("2026-04-07T04:00:00.000Z") !== "07:00:00") {
  throw new Error("Intl is not formatting Asia/Jerusalem dates as YYYY-MM-DD / HH:MM:SS on this Node build.");
}

// ---------------------------------------------------------------------------
// Option sets. The Data API returns option values as their display text
// (Hebrew for most sets). Any value not listed here stops the import before
// it touches the database, so a new value gets mapped deliberately, never
// guessed.
// ---------------------------------------------------------------------------

type CompanyType = "backoffice" | "grower" | "customer" | "transporter";
type UserRole = "backoffice" | "grower" | "customer";
type TradingDayPhase = "initiated" | "shop_open" | "shop_closed" | "closed";

// Admin (מנהל מערכת) and Distributor (משווק) are one role in this schema —
// see packages/db/src/schema/enums.ts.
const COMPANY_TYPES: Readonly<Record<string, CompanyType>> = {
  "משווק": "backoffice",
  "מנהל מערכת": "backoffice",
  "מגדל": "grower",
  "לקוח": "customer",
  "מוביל": "transporter",
};
const COMPANY_STATUSES: Readonly<Record<string, "active" | "inactive">> = { "פעיל": "active", "לא פעיל": "inactive" };
const USER_ROLES: Readonly<Record<string, UserRole>> = {
  "משווק": "backoffice",
  "מנהל מערכת": "backoffice",
  "מגדל": "grower",
  "לקוח": "customer",
};
// Transporters never sign in (packages/db/src/schema/enums.ts), so a
// transporter login has nothing to become.
const TRANSPORTER_ROLE = "מוביל";
const PICK_STATUSES: Readonly<Record<string, "draft" | "submitted" | "closed">> = {
  "טיוטה": "draft",
  "נשלח": "submitted",
  "נסגר": "closed",
};
// Only Open and Submitted are ever assigned in the source
// (reference/prd/state-machines/order-status-state-machine.md).
const ORDER_STATUSES: Readonly<Record<string, "open" | "submitted">> = { "פתוחה": "open", "נשלחה למשווק": "submitted" };
const ARRANGEMENT_STATUSES: Readonly<Record<string, "open" | "closed">> = { Open: "open", Close: "closed" };
const SHOP_STATUSES: Readonly<Record<string, "open" | "closed">> = { Open: "open", Closed: "closed" };
// The historical_* values exist for exactly this (migration 0027).
const SESSION_TYPES: Readonly<Record<string, string>> = {
  "close shop": "close_shop",
  "end the day": "end_the_day",
  "initiate day": "historical_initiate_day",
  "open shop": "historical_open_shop",
  update: "historical_update",
};
const NOTIFICATION_CHANNELS: Readonly<Record<string, "whatsapp">> = { whatsapp: "whatsapp" };

const unknownOptionValues = new Map<string, Set<string>>();

function lookup<T>(map: Readonly<Record<string, T>>, value: string | null, label: string): T | null {
  if (value === null) return null;
  const mapped = map[value];
  if (mapped === undefined) {
    const seen = unknownOptionValues.get(label) ?? new Set<string>();
    seen.add(value);
    unknownOptionValues.set(label, seen);
    return null;
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Issues: everything not imported cleanly, per record or aggregated.
// ---------------------------------------------------------------------------

type Severity = "info" | "warning" | "error";

interface Issue {
  severity: Severity;
  entityType: string;
  bubbleId: string | null;
  code: string;
  message: string;
}

class Report {
  readonly issues: Issue[] = [];
  // Conditions that make the import unsafe to run at all. Checked before the
  // database is touched.
  readonly blockers: string[] = [];

  note(severity: Severity, entityType: string, bubbleId: string | null, code: string, message: string) {
    this.issues.push({ severity, entityType, bubbleId, code, message });
  }

  fieldsNotImported(entityType: string, records: BubbleRecord[], fields: string[], why: string) {
    for (const field of fields) {
      const count = records.filter((record) => {
        const value = record[field];
        return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
      }).length;
      if (count > 0) this.note("info", entityType, null, "field_not_imported", `${count} record(s) have "${field}" — ${why}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Target tables
// ---------------------------------------------------------------------------

const COLUMNS = {
  companies: ["id", "name", "type", "status", "default_pickup_time", "can_see_product_prices", "whatsapp_group_id", "created_at", "updated_at"],
  profiles: ["user_id", "company_id", "role", "display_name", "phone_number", "must_change_password", "created_at", "updated_at"],
  product_families: ["id", "name", "category", "image_url", "created_at", "updated_at"],
  product_varieties: [
    "id", "family_id", "name", "sizes", "price", "price_range_from", "price_range_to", "price_type", "no_overbooking",
    "highlight_price_fluctuations", "is_seasonal_available", "number_of_orders_per_customer", "created_at", "updated_at",
  ],
  grower_products: ["company_id", "product_variety_id"],
  profile_blocked_products: ["user_id", "product_variety_id"],
  trading_days: ["id", "trade_date", "phase", "initiated_by", "created_at", "updated_at"],
  daily_arrangements: ["id", "trading_day_id", "status", "created_at", "closed_at"],
  daily_shops: ["id", "trading_day_id", "status", "can_see_prices", "opened_by", "created_at", "updated_at"],
  daily_picks: ["id", "trading_day_id", "grower_company_id", "status", "submitted_at", "pickup_time", "created_at", "updated_at"],
  daily_pick_products: ["id", "daily_pick_id", "product_variety_id", "pallets_picked", "comment", "leftover_pallets", "created_at", "updated_at"],
  daily_orders: ["id", "trading_day_id", "customer_company_id", "status", "submitted_at", "created_at", "updated_at"],
  daily_order_products: ["id", "daily_order_id", "product_variety_id", "pallets_ordered", "comment", "created_at", "updated_at"],
  arrangement_records: [
    "id", "daily_arrangement_id", "daily_pick_product_id", "daily_order_product_id", "customer_company_id",
    "quantity_pallets", "price", "price_type", "created_at", "updated_at",
  ],
  order_submission_logs: ["id", "daily_order_id", "submitted_by", "snapshot", "created_at"],
  lifecycle_sessions: ["id", "trading_day_id", "session_type", "performed_by", "metadata", "created_at"],
  notification_templates: ["id", "template_key", "channel", "title", "content", "link", "created_at", "updated_at"],
} as const;
type TableName = keyof typeof COLUMNS;

// Insert order: every table after the ones its foreign keys point at.
const TABLE_ORDER: TableName[] = [
  "companies",
  "profiles",
  "product_families",
  "product_varieties",
  "grower_products",
  "profile_blocked_products",
  "trading_days",
  "daily_arrangements",
  "daily_shops",
  "daily_picks",
  "daily_pick_products",
  "daily_orders",
  "daily_order_products",
  "arrangement_records",
  "order_submission_logs",
  "lifecycle_sessions",
  "notification_templates",
];

const JSON_COLUMNS = new Set(["snapshot", "metadata"]);

// Every template this import writes carries this prefix, so a re-run can
// replace exactly those without touching the templates migrations seed.
const TEMPLATE_KEY_PREFIX = "bubble_mainalert_";

// ---------------------------------------------------------------------------
// Loading the snapshot
// ---------------------------------------------------------------------------

async function loadExport(): Promise<{ data: ExportData; exportedAt: string }> {
  const manifest = JSON.parse(await readFile(path.join(EXPORT_DIR, "_manifest.json"), "utf8")) as {
    bubbleEnv: string;
    exportedAt: string;
    counts: Record<string, number>;
  };
  if (manifest.bubbleEnv !== BUBBLE_ENV) {
    throw new Error(`${EXPORT_DIR} holds a "${manifest.bubbleEnv}" export, not "${BUBBLE_ENV}".`);
  }
  const data = {} as ExportData;
  for (const type of DATA_TYPES) {
    const records = JSON.parse(await readFile(path.join(EXPORT_DIR, `${type}.json`), "utf8")) as BubbleRecord[];
    if (records.length !== manifest.counts[type]) {
      throw new Error(`${type}.json has ${records.length} records but the manifest says ${manifest.counts[type]} — re-run the export.`);
    }
    data[type] = records;
  }
  return { data, exportedAt: manifest.exportedAt };
}

// ---------------------------------------------------------------------------
// Plan, part 1: companies, logins, product catalog. Built once; row ids are
// generated here and reused by part 2.
// ---------------------------------------------------------------------------

interface PlannedUser {
  bubbleId: string;
  email: string;
  companyId: string;
  role: UserRole;
  displayName: string;
  phoneNumber: string | null;
  createdAt: string;
  updatedAt: string;
  blockedVarietyIds: string[];
}

interface ReferencePlan {
  companies: Row[];
  transporterLinks: Array<{ id: string; transporter_company_id: string }>;
  users: PlannedUser[];
  productFamilies: Row[];
  productVarieties: Row[];
  growerProducts: Row[];
  companyIdByBubbleId: Map<string, string>;
  varietyIdByBubbleId: Map<string, string>;
  distributorBubbleUserId: string;
  idMap: Row[];
}

const UNNAMED_COMPANY = "(ללא שם)";

function planReference(data: ExportData, report: Report): ReferencePlan {
  const idMap: Row[] = [];
  const appSettings = data.appsettings[0];
  if (!appSettings) throw new Error("The export has no appsettings record — it cannot identify the distributor.");

  // Bubble's app settings name the distributor account that handles password
  // resets. That account's company is the distributor's own company, and that
  // login is who gets credited for Bubble actions whose real actor is unknown.
  const distributorBubbleUserId = text(appSettings, "assigned distributor for reset password");
  const distributorUser = data.user.find((user) => user._id === distributorBubbleUserId);
  const distributorCompanyBubbleId = distributorUser ? text(distributorUser, "Company") : null;
  if (!distributorBubbleUserId || !distributorUser || !distributorCompanyBubbleId) {
    throw new Error("appsettings' \"assigned distributor for reset password\" does not resolve to a user with a company.");
  }

  // ---- companies
  const referencedCompanyIds = new Set<string>();
  for (const [records, field] of [
    [data.user, "Company"],
    [data.dailypick, "linked to company (grower)"],
    [data.dailyorder, "link to company (customer)"],
    [data.dailyarrangementrecords, "linked to company (customer)"],
    [data.company, "Transporter"],
  ] as const) {
    for (const record of records) {
      const id = text(record, field);
      if (id) referencedCompanyIds.add(id);
    }
  }

  const companies: Row[] = [];
  const companyIdByBubbleId = new Map<string, string>();
  const companyTypeByBubbleId = new Map<string, CompanyType>();

  for (const company of data.company) {
    let name = text(company, "Name");
    if (!name) {
      if (!referencedCompanyIds.has(company._id)) {
        report.note("info", "company", company._id, "company.no_name_skipped", "No name and nothing references it — not imported (companies.name is required).");
        continue;
      }
      name = UNNAMED_COMPANY;
      report.note("warning", "company", company._id, "company.no_name", `No name, but other records reference it — imported as "${UNNAMED_COMPANY}".`);
    }

    const bubbleType = text(company, "Type");
    const bubbleStatus = text(company, "Status");
    let type = lookup(COMPANY_TYPES, bubbleType, "company.Type");
    let status = lookup(COMPANY_STATUSES, bubbleStatus, "company.Status");
    if ((bubbleType !== null && type === null) || (bubbleStatus !== null && status === null)) continue;
    if (type === null) {
      report.note("error", "company", company._id, "company.no_type", `"${name}" has no Type — not imported.`);
      continue;
    }
    if (status === null) {
      // Status gates participation in the trading cycle; an unset status is
      // not "active" in Bubble either, so it stays out of the cycle.
      status = "inactive";
      report.note("warning", "company", company._id, "company.no_status", `"${name}" has no Status — imported as inactive.`);
    }

    // Decision (2026-09-16): Bubble has the distributor's own company typed as
    // an inactive grower with no picks or orders. It is imported as the active
    // backoffice company, because backoffice notifications are addressed to
    // active backoffice companies (enqueue_backoffice_notification, 0031).
    if (company._id === distributorCompanyBubbleId && (type !== "backoffice" || status !== "active")) {
      report.note("info", "company", company._id, "company.distributor_company", `"${name}" is Bubble ${bubbleType}/${bubbleStatus ?? "no status"} — imported as the active backoffice company.`);
      type = "backoffice";
      status = "active";
    }

    const pickupTime = text(company, "Default Pickup Time");
    const id = randomUUID();
    companies.push({
      id,
      name,
      type,
      status,
      default_pickup_time: pickupTime ? israelTime(pickupTime) : null,
      can_see_product_prices: booleanValue(company, "Can see product prices"),
      whatsapp_group_id: text(company, "group id (whatsapp)"),
      created_at: createdAt(company),
      updated_at: modifiedAt(company),
    });
    companyIdByBubbleId.set(company._id, id);
    companyTypeByBubbleId.set(company._id, type);
    idMap.push({ bubble_id: company._id, entity_type: "company", new_id: id });
  }

  const transporterLinks: ReferencePlan["transporterLinks"] = [];
  for (const company of data.company) {
    const transporterBubbleId = text(company, "Transporter");
    const companyId = companyIdByBubbleId.get(company._id);
    if (!transporterBubbleId || !companyId) continue;
    const transporterId = companyIdByBubbleId.get(transporterBubbleId);
    if (!transporterId) {
      report.note("warning", "company", company._id, "company.transporter_missing", "Its Transporter was not imported — link dropped.");
      continue;
    }
    if (companyTypeByBubbleId.get(transporterBubbleId) !== "transporter") {
      report.note("warning", "company", company._id, "company.transporter_not_transporter", "Its Transporter is not a transporter company — linked anyway.");
    }
    transporterLinks.push({ id: companyId, transporter_company_id: transporterId });
  }

  const shouldNotReceive = data.company.filter((company) => booleanValue(company, "Should not receive arrangement?") === true).length;
  if (shouldNotReceive > 0) {
    report.note("warning", "company", null, "field_not_imported", `${shouldNotReceive} company(ies) have "Should not receive arrangement?" = yes — this schema has no such setting, so they will receive arrangement messages like everyone else.`);
  }
  report.fieldsNotImported(
    "company",
    data.company,
    ["Address Line", "Area code", "City", "Tax ID", "Accounting ID", "Phone no.", "Phone prefix", "Code in external system", "Comments", "Main Contact", "logo", "default product category"],
    "no column for it in companies",
  );

  // ---- product catalog
  const productFamilies: Row[] = [];
  const familyIdByBubbleId = new Map<string, string>();
  for (const family of data.productfamily) {
    const name = text(family, "Name");
    if (!name) {
      report.note("warning", "productfamily", family._id, "family.no_name", "No name — not imported.");
      continue;
    }
    const categories = idList(family, "Product Categories");
    if (categories.length > 1) {
      report.note("info", "productfamily", family._id, "family.several_categories", `"${name}" has ${categories.length} categories — kept the first, "${categories[0]}".`);
    }
    const image = text(family, "image");
    const id = randomUUID();
    productFamilies.push({
      id,
      name,
      category: categories[0] ?? text(family, "Product category"),
      // Bubble serves uploads from a protocol-relative CDN URL ("//...").
      image_url: image?.startsWith("//") ? `https:${image}` : image,
      created_at: createdAt(family),
      updated_at: modifiedAt(family),
    });
    familyIdByBubbleId.set(family._id, id);
    idMap.push({ bubble_id: family._id, entity_type: "productfamily", new_id: id });
  }

  const productVarieties: Row[] = [];
  const varietyIdByBubbleId = new Map<string, string>();
  const varietyIdsByFamilyBubbleId = new Map<string, string[]>();
  const varietyNaturalKeys = new Set<string>();
  for (const variety of data.productvarieties) {
    const familyBubbleId = text(variety, "Product Family");
    const familyId = familyBubbleId ? familyIdByBubbleId.get(familyBubbleId) : undefined;
    if (!familyBubbleId || !familyId) {
      report.note("warning", "productvarieties", variety._id, "variety.family_missing", "Its product family was not imported — not imported.");
      continue;
    }
    // "Variety" is the variety's own name; Bubble's "Name" on a variety repeats
    // the family name.
    const name = text(variety, "Variety") ?? text(variety, "Name");
    if (!name) {
      report.note("warning", "productvarieties", variety._id, "variety.no_name", "No Variety or Name — not imported.");
      continue;
    }
    const sizes = text(variety, "Size");
    const naturalKey = `${familyId}|${name}|${sizes ?? ""}`;
    if (varietyNaturalKeys.has(naturalKey)) {
      report.note("info", "productvarieties", variety._id, "variety.duplicate", `Same family, variety and size as another variety ("${name}" ${sizes ?? ""}) — imported as a separate row, as in Bubble.`);
    }
    varietyNaturalKeys.add(naturalKey);

    const inSeason = booleanValue(variety, "In season");
    if (inSeason === null) {
      report.note("info", "productvarieties", variety._id, "variety.no_in_season", `"${name}" has no "In season" value — imported as not in season (Bubble treats unset as no).`);
    }
    let cap = numberValue(variety, "No. of pallets per wholesaler");
    if (cap !== null && !Number.isInteger(cap)) {
      report.note("warning", "productvarieties", variety._id, "variety.cap_not_integer", `"${name}" per-customer cap ${cap} is not a whole number — imported as no cap.`);
      cap = null;
    }
    if (cap === 0 && CAP_ZERO_MEANS_NO_CAP) {
      report.note("info", "productvarieties", variety._id, "variety.cap_zero", `"${name}" per-customer cap is 0 — imported as no cap.`);
      cap = null;
    }

    const id = randomUUID();
    productVarieties.push({
      id,
      family_id: familyId,
      name,
      sizes,
      price: numberValue(variety, "Price"),
      price_range_from: numberValue(variety, "Price Range from"),
      price_range_to: numberValue(variety, "Price Range to"),
      price_type: text(variety, "Price Type"),
      no_overbooking: numberValue(variety, "Overbooking") ?? 0,
      highlight_price_fluctuations: booleanValue(variety, "Highlight Price Fluctuations") ?? false,
      is_seasonal_available: inSeason ?? false,
      number_of_orders_per_customer: cap,
      created_at: createdAt(variety),
      updated_at: modifiedAt(variety),
    });
    varietyIdByBubbleId.set(variety._id, id);
    varietyIdsByFamilyBubbleId.set(familyBubbleId, [...(varietyIdsByFamilyBubbleId.get(familyBubbleId) ?? []), id]);
    idMap.push({ bubble_id: variety._id, entity_type: "productvarieties", new_id: id });
    if (booleanValue(variety, "archived?") === true) {
      report.note("info", "productvarieties", variety._id, "variety.archived", `"${name}" is archived in Bubble — imported (this schema has no archive flag).`);
    }
  }
  report.fieldsNotImported("productvarieties", data.productvarieties, ["Image", "Comments", "Category"], "no column for it in product_varieties");

  // A grower's "Products in season" list is the grower_products join table.
  const growerProducts: Row[] = [];
  for (const company of data.company) {
    const varietyBubbleIds = idList(company, "Products in season");
    const companyId = companyIdByBubbleId.get(company._id);
    if (!varietyBubbleIds.length || !companyId) continue;
    if (companyTypeByBubbleId.get(company._id) !== "grower") {
      report.note("warning", "company", company._id, "company.in_season_not_grower", "Has an in-season product list but is not a grower — list not imported.");
      continue;
    }
    const seen = new Set<string>();
    for (const varietyBubbleId of varietyBubbleIds) {
      const varietyId = varietyIdByBubbleId.get(varietyBubbleId);
      if (!varietyId) {
        report.note("warning", "company", company._id, "company.in_season_variety_missing", `In-season variety ${varietyBubbleId} was not imported — left out of the list.`);
        continue;
      }
      if (seen.has(varietyId)) continue;
      seen.add(varietyId);
      growerProducts.push({ company_id: companyId, product_variety_id: varietyId });
    }
  }

  // ---- logins
  const users: PlannedUser[] = [];
  const seenEmails = new Set<string>();
  for (const user of data.user) {
    const authentication = user.authentication as { email?: { email?: unknown } } | undefined;
    const rawEmail = authentication?.email?.email;
    // Same normalisation as packages/domain/src/auth/email.ts.
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const displayName = `${text(user, "First Name") ?? ""} ${text(user, "Last name") ?? ""}`.trim();
    const who = displayName || user._id;
    if (!email) {
      report.note("error", "user", user._id, "user.no_email", `${who} has no email — a login cannot exist without one; not imported.`);
      continue;
    }
    if (seenEmails.has(email)) {
      report.note("error", "user", user._id, "user.duplicate_email", `${who} shares an email with another user — not imported.`);
      continue;
    }

    const bubbleRole = text(user, "Role");
    if (bubbleRole === TRANSPORTER_ROLE) {
      report.note("info", "user", user._id, "user.transporter_login", `${who} is a transporter login — transporters never sign in to this app; not imported.`);
      continue;
    }
    const role = lookup(USER_ROLES, bubbleRole, "user.Role");
    if (bubbleRole === null) {
      report.note("warning", "user", user._id, "user.no_role", `${who} has no Role — not imported.`);
      continue;
    }
    if (role === null) continue;

    let companyBubbleId = text(user, "Company");
    if (!companyBubbleId && role === "backoffice") {
      // Decision (2026-09-16): a distributor login without a company joins the
      // distributor's company — a profile cannot exist without one.
      companyBubbleId = distributorCompanyBubbleId;
      report.note("info", "user", user._id, "user.distributor_without_company", `${who} is a distributor with no company — attached to the distributor's company.`);
    }
    if (!companyBubbleId) {
      report.note("warning", "user", user._id, "user.no_company", `${who} has no company — a login needs one; not imported.`);
      continue;
    }
    const companyId = companyIdByBubbleId.get(companyBubbleId);
    if (!companyId) {
      report.note("warning", "user", user._id, "user.company_missing", `${who}'s company was not imported — not imported.`);
      continue;
    }
    if (companyTypeByBubbleId.get(companyBubbleId) !== role) {
      report.note("warning", "user", user._id, "user.role_company_mismatch", `${who} is a ${role} login on a ${companyTypeByBubbleId.get(companyBubbleId)} company — imported as-is.`);
    }

    let phoneNumber = text(user, "Phone Number");
    if (phoneNumber && !/^[0-9+\-\s()]+$/.test(phoneNumber)) {
      // WhatsApp dispatch dials this number; a value with letters in it can
      // never be dialled, so it is left empty rather than carried over.
      report.note("warning", "user", user._id, "user.phone_not_a_number", `${who}'s phone number is not a number — left empty.`);
      phoneNumber = null;
    }

    // Bubble blocks whole product FAMILIES per user; this schema blocks
    // varieties. Every variety in a blocked family is blocked — varieties
    // added to that family later are not.
    const blockedVarietyIds = new Set<string>();
    for (const familyBubbleId of idList(user, "Products Blacklist")) {
      const varietyIds = varietyIdsByFamilyBubbleId.get(familyBubbleId) ?? [];
      for (const varietyId of varietyIds) blockedVarietyIds.add(varietyId);
      report.note("info", "user", user._id, "user.blocked_family_expanded", `${who}: blocked family ${familyBubbleId} expanded to its ${varietyIds.length} current variety(ies).`);
    }

    seenEmails.add(email);
    users.push({
      bubbleId: user._id,
      email,
      companyId,
      role,
      displayName: displayName || email,
      phoneNumber,
      createdAt: createdAt(user),
      updatedAt: modifiedAt(user),
      blockedVarietyIds: [...blockedVarietyIds],
    });
  }
  if (!users.some((user) => user.bubbleId === distributorBubbleUserId)) {
    report.blockers.push("The assigned distributor login is not importable — it is needed to credit Bubble actions whose actor is unknown.");
  }
  report.fieldsNotImported(
    "user",
    data.user,
    ["Phone number prefix", "Comments", "default product category", "Developer?", "email_display", "company name", "Type"],
    "no column for it in profiles",
  );

  return {
    companies,
    transporterLinks,
    users,
    productFamilies,
    productVarieties,
    growerProducts,
    companyIdByBubbleId,
    varietyIdByBubbleId,
    distributorBubbleUserId,
    idMap,
  };
}

// ---------------------------------------------------------------------------
// Plan, part 2: everything that refers to a login — profiles, trading days
// and their contents. Rebuilt once the real login ids are known.
// ---------------------------------------------------------------------------

interface Day {
  bubble: BubbleRecord;
  id: string;
  arrangementId: string;
  tradeDate: string;
  created: string;
  bubbleClosed: boolean;
  isLive: boolean;
  phase: TradingDayPhase;
  shop: BubbleRecord | null;
  shopId: string | null;
}

interface TradingPlan {
  rows: Record<TableName, Row[]>;
  idMap: Row[];
  liveDay: Day | null;
}

type OrderRef = { id: string; day: Day; customerId: string };
type PickLineRef = { id: string; day: Day; varietyId: string };
type OrderLineCandidate = {
  id: string;
  order: OrderRef;
  varietyId: string;
  pallets: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  bubbleId: string | null;
  neededByArrangement: boolean;
};

// Bubble writes each order-log entry by string concatenation and leaves out
// the comma between the "user" object and "date", so as stored it is not
// valid JSON. That one comma is put back; anything still unparseable is
// reported, not guessed at.
function parseOrderLog(raw: string): { userBubbleId: string; date: string; lines: Array<{ varietyBubbleId: string; order: string; comment: string }> } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/\}\s*\n\s*"date"/, '},\n"date"'));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const entry = value as { user?: { "unique id"?: unknown }; date?: unknown; order_data?: unknown };
  const userBubbleId = entry.user?.["unique id"];
  const date = entry.date;
  if (typeof userBubbleId !== "string" || typeof date !== "string" || Number.isNaN(Date.parse(date)) || !Array.isArray(entry.order_data)) {
    return null;
  }
  const lines: Array<{ varietyBubbleId: string; order: string; comment: string }> = [];
  for (const item of entry.order_data) {
    if (typeof item !== "object" || item === null) return null;
    const line = item as Record<string, unknown>;
    if (typeof line["variety unique id"] !== "string") return null;
    lines.push({
      varietyBubbleId: line["variety unique id"],
      order: String(line.order ?? ""),
      comment: typeof line.comment === "string" ? line.comment : "",
    });
  }
  return { userBubbleId, date, lines };
}

function parsePrice(value: string | null): number | null | "invalid" {
  if (value === null) return null;
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : "invalid";
}

function planTrading(data: ExportData, reference: ReferencePlan, loginIds: Map<string, string>, report: Report): TradingPlan {
  const rows = Object.fromEntries(TABLE_ORDER.map((table) => [table, [] as Row[]])) as Record<TableName, Row[]>;
  const idMap: Row[] = [];
  const loginFor = (bubbleUserId: string | null) => (bubbleUserId ? (loginIds.get(bubbleUserId) ?? null) : null);
  const fallbackLogin = loginIds.get(reference.distributorBubbleUserId);
  if (!fallbackLogin) throw new Error("No login id for the assigned distributor.");

  // ---- profiles
  for (const user of reference.users) {
    const userId = loginIds.get(user.bubbleId);
    if (!userId) throw new Error(`No login id for user ${user.bubbleId}.`);
    rows.profiles.push({
      user_id: userId,
      company_id: user.companyId,
      role: user.role,
      display_name: user.displayName,
      phone_number: user.phoneNumber,
      must_change_password: true,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    });
    for (const varietyId of user.blockedVarietyIds) rows.profile_blocked_products.push({ user_id: userId, product_variety_id: varietyId });
    idMap.push({ bubble_id: user.bubbleId, entity_type: "user", new_id: userId });
  }

  // ---- trading days
  // Bubble has no trading-day record. "Initiate business day" creates a Daily
  // Arrangement, so each arrangement is one trading day, and everything else
  // dated that day belongs to it.
  const appSettings = data.appsettings[0]!;
  const liveArrangementBubbleId = text(appSettings, "day status") === "open" ? text(appSettings, "active daily arrangement") : null;

  const days: Day[] = [];
  const daysByDate = new Map<string, Day[]>();
  const dayByArrangementBubbleId = new Map<string, Day>();
  for (const arrangement of [...data.dailyarrangement].sort(byCreated)) {
    const date = text(arrangement, "Date");
    const bubbleStatus = text(arrangement, "status");
    const status = lookup(ARRANGEMENT_STATUSES, bubbleStatus, "dailyarrangement.status");
    if (!date || status === null) {
      if (bubbleStatus !== null && status === null) continue;
      report.blockers.push(`Daily arrangement ${arrangement._id} has no Date or status.`);
      continue;
    }
    const tradeDate = israelDate(date);
    const isLive = arrangement._id === liveArrangementBubbleId && status === "open";

    // A second "Open" arrangement for the same date created within a minute
    // of the first is a double-click on "initiate business day", not a day of
    // its own. It is left out; the date rule below then gives everything
    // created after it to the first arrangement, its real day.
    const twin = (daysByDate.get(tradeDate) ?? []).find((day) => Date.parse(createdAt(arrangement)) - Date.parse(day.created) <= 60_000);
    if (status === "open" && !isLive && twin) {
      report.note("info", "dailyarrangement", arrangement._id, "day.double_click_duplicate", `Duplicate Open arrangement for ${tradeDate}, created within a minute of another — merged into that day.`);
      dayByArrangementBubbleId.set(arrangement._id, twin);
      continue;
    }

    const day: Day = {
      bubble: arrangement,
      id: randomUUID(),
      arrangementId: randomUUID(),
      tradeDate,
      created: createdAt(arrangement),
      bubbleClosed: status === "closed",
      isLive,
      phase: "closed",
      shop: null,
      shopId: null,
    };
    if (status === "open" && !isLive) {
      // Decision (2026-09-16): an arrangement left Open that is not Bubble's
      // live day was abandoned; this schema allows one open day, so it is
      // imported as a closed day with all its contents.
      report.note("info", "dailyarrangement", arrangement._id, "day.abandoned_closed", `Abandoned Open day ${tradeDate} (initiated ${day.created.slice(0, 10)}) — imported as closed.`);
    }
    days.push(day);
    daysByDate.set(tradeDate, [...(daysByDate.get(tradeDate) ?? []), day]);
    dayByArrangementBubbleId.set(arrangement._id, day);
  }
  if (liveArrangementBubbleId && !days.some((day) => day.isLive)) {
    report.blockers.push(`appsettings points at live arrangement ${liveArrangementBubbleId}, which is not an Open arrangement in the export.`);
  }

  // Which trading day a dated record belongs to. Usually one day has that
  // date. When a date was initiated more than once (re-run test days), the
  // record belongs to the latest of those days initiated at or before the
  // record itself was created.
  let createdBeforeEveryDay = 0;
  const dayFor = (date: string | null, created: string): Day | null => {
    if (!date) return null;
    const candidates = daysByDate.get(israelDate(date)) ?? [];
    if (candidates.length <= 1) return candidates[0] ?? null;
    let chosen: Day | null = null;
    for (const day of candidates) if (day.created <= created) chosen = day;
    if (!chosen) createdBeforeEveryDay++;
    return chosen ?? candidates[0] ?? null;
  };

  // ---- shops
  const dayByShopBubbleId = new Map<string, Day>();
  const ordersPerShop = new Map<string, number>();
  for (const order of data.dailyorder) {
    const shopBubbleId = text(order, "linked to daily shop");
    if (shopBubbleId) ordersPerShop.set(shopBubbleId, (ordersPerShop.get(shopBubbleId) ?? 0) + 1);
  }
  for (const shop of [...data.dailyshop].sort(byCreated)) {
    const bubbleStatus = text(shop, "Status");
    if (bubbleStatus !== null && lookup(SHOP_STATUSES, bubbleStatus, "dailyshop.Status") === null) continue;
    const day = dayFor(text(shop, "Date"), createdAt(shop));
    const orders = ordersPerShop.get(shop._id) ?? 0;
    if (!day) {
      // Decision (2026-09-16): shops from before arrangements existed hold no
      // picks, orders or arrangement, so there is no day to put them on.
      if (orders > 0) report.blockers.push(`Shop ${shop._id} has ${orders} order(s) but no trading day.`);
      report.note("info", "dailyshop", shop._id, "shop.no_trading_day", `Shop for ${israelDate(createdAt(shop))} has no trading day and no orders — not imported.`);
      continue;
    }
    // Its orders still belong to this day even when the shop row itself is a
    // repeat that cannot be kept.
    dayByShopBubbleId.set(shop._id, day);
    if (day.shop) {
      report.note("info", "dailyshop", shop._id, "shop.repeat", `Shop opened again on ${day.tradeDate}, which already has one (${orders} order(s) linked) — not imported; a day has one shop.`);
      continue;
    }
    day.shop = shop;
    day.shopId = randomUUID();
  }

  for (const day of days) {
    if (!day.isLive) {
      day.phase = "closed";
    } else if (!day.shop) {
      day.phase = "initiated";
    } else {
      day.phase = text(day.shop, "Status") === "Closed" ? "shop_closed" : "shop_open";
    }

    const initiatedBy = loginFor(text(day.bubble, "Created By"));
    if (!initiatedBy) {
      report.note("info", "dailyarrangement", day.bubble._id, "day.initiated_by_fallback", `Initiator of ${day.tradeDate} is not an imported login — credited to the assigned distributor.`);
    }
    rows.trading_days.push({
      id: day.id,
      trade_date: day.tradeDate,
      phase: day.phase,
      initiated_by: initiatedBy ?? fallbackLogin,
      created_at: day.created,
      updated_at: modifiedAt(day.bubble),
    });
    rows.daily_arrangements.push({
      id: day.arrangementId,
      trading_day_id: day.id,
      status: day.phase === "closed" ? "closed" : "open",
      created_at: day.created,
      // Bubble's last modification of a closed arrangement is the close. An
      // abandoned day was never closed, so it has no close time.
      closed_at: day.bubbleClosed ? modifiedAt(day.bubble) : null,
    });
    idMap.push({ bubble_id: `trading_day:${day.bubble._id}`, entity_type: "trading_day", new_id: day.id });
    idMap.push({ bubble_id: day.bubble._id, entity_type: "dailyarrangement", new_id: day.arrangementId });

    if (day.shop && day.shopId) {
      const openedBy = loginFor(text(day.shop, "Created By"));
      if (!openedBy) {
        report.note("info", "dailyshop", day.shop._id, "shop.opened_by_fallback", `Opener of the ${day.tradeDate} shop is not an imported login — credited to the assigned distributor.`);
      }
      rows.daily_shops.push({
        id: day.shopId,
        trading_day_id: day.id,
        status: day.phase === "shop_open" ? "open" : "closed",
        // Bubble reads an unset yes/no field as "no".
        can_see_prices: booleanValue(day.shop, "can see prices?") ?? false,
        opened_by: openedBy ?? fallbackLogin,
        created_at: createdAt(day.shop),
        updated_at: modifiedAt(day.shop),
      });
      idMap.push({ bubble_id: day.shop._id, entity_type: "dailyshop", new_id: day.shopId });
    }
  }

  // Pallets arranged per Bubble pick line, from every record the import keeps.
  const arrangedByBubblePickLine = new Map<string, number>();
  for (const record of data.dailyarrangementrecords) {
    const quantity = numberValue(record, "Number Pallets Arranged");
    const pickLineBubbleId = text(record, "linked to daily pick product");
    if (quantity !== null && quantity > 0 && pickLineBubbleId) {
      arrangedByBubblePickLine.set(pickLineBubbleId, (arrangedByBubblePickLine.get(pickLineBubbleId) ?? 0) + quantity);
    }
  }

  // ---- picks
  const pickByBubbleId = new Map<string, { id: string; day: Day }>();
  const pickKeys = new Set<string>();
  let picksClosedWithDay = 0;
  for (const pick of data.dailypick) {
    const bubbleStatus = text(pick, "Status");
    const bubblePickStatus = lookup(PICK_STATUSES, bubbleStatus, "dailypick.Status");
    if (bubbleStatus !== null && bubblePickStatus === null) continue;
    const day = dayFor(text(pick, "Date"), createdAt(pick));
    if (!day) {
      report.note("warning", "dailypick", pick._id, "pick.no_trading_day", "No trading day on its date — not imported.");
      continue;
    }
    const growerBubbleId = text(pick, "linked to company (grower)");
    const growerId = growerBubbleId ? reference.companyIdByBubbleId.get(growerBubbleId) : undefined;
    if (!growerId) {
      report.note("warning", "dailypick", pick._id, "pick.grower_missing", "Its grower was not imported — not imported.");
      continue;
    }
    if (bubblePickStatus === null) {
      report.note("warning", "dailypick", pick._id, "pick.no_status", "No status — not imported.");
      continue;
    }
    const key = `${day.id}|${growerId}`;
    if (pickKeys.has(key)) {
      report.blockers.push(`Two picks for one grower on trading day ${day.tradeDate} (pick ${pick._id}).`);
      continue;
    }
    pickKeys.add(key);

    // A closed day's picks are closed, as close_arrangement leaves them.
    const status = day.phase === "closed" ? "closed" : bubblePickStatus;
    if (status !== bubblePickStatus) picksClosedWithDay++;
    const pickupTime = text(pick, "Pickup Time");
    const id = randomUUID();
    rows.daily_picks.push({
      id,
      trading_day_id: day.id,
      grower_company_id: growerId,
      status,
      submitted_at: text(pick, "Submission Time"),
      // The pick's own pickup-time snapshot exists from submission onwards
      // (migration 0043); a draft shows the grower company's live default.
      pickup_time: status !== "draft" && pickupTime ? israelTime(pickupTime) : null,
      created_at: createdAt(pick),
      updated_at: modifiedAt(pick),
    });
    pickByBubbleId.set(pick._id, { id, day });
    idMap.push({ bubble_id: pick._id, entity_type: "dailypick", new_id: id });
  }
  if (picksClosedWithDay > 0) {
    report.note("info", "dailypick", null, "pick.closed_with_day", `${picksClosedWithDay} draft/submitted pick(s) on abandoned days — imported as closed with their day.`);
  }

  // ---- pick lines
  // Bubble keeps two records per line: the real one, and a temp copy the
  // grower's screen edits and copies back to the real one on "confirm". Only
  // the real record holds what the grower committed; temp copies are skipped.
  const tempPicked = new Map<string, number>();
  let tempRecords = 0;
  for (const line of data.dailypickproduct) {
    if (line["Is Temp Record?"] !== true) continue;
    tempRecords++;
    const picked = numberValue(line, "Pallets picked");
    if (picked !== null) tempPicked.set(`${text(line, "linked to daily pick")}|${text(line, "linked to product variety")}`, picked);
  }
  report.note("info", "dailypickproduct", null, "pick_line.temp_records", `${tempRecords} temp pick-line copies skipped — the real record of each pair is imported.`);

  const pickLineByBubbleId = new Map<string, PickLineRef>();
  const pickLineByPickVariety = new Map<string, PickLineRef>();
  for (const line of data.dailypickproduct) {
    if (line["Is Temp Record?"] === true) continue;
    const pickBubbleId = text(line, "linked to daily pick");
    const pick = pickBubbleId ? pickByBubbleId.get(pickBubbleId) : undefined;
    if (!pick) {
      report.note("warning", "dailypickproduct", line._id, "pick_line.pick_missing", "Its pick was not imported — not imported.");
      continue;
    }
    const varietyBubbleId = text(line, "linked to product variety");
    const varietyId = varietyBubbleId ? reference.varietyIdByBubbleId.get(varietyBubbleId) : undefined;
    const picked = numberValue(line, "Pallets picked");
    if (!varietyId) {
      report.note("warning", "dailypickproduct", line._id, "pick_line.variety_missing", `Its product variety no longer exists (pallets picked: ${picked ?? "empty"}, day ${pick.day.tradeDate}) — not imported.`);
      continue;
    }
    const key = `${pick.id}|${varietyId}`;
    if (pickLineByPickVariety.has(key)) {
      report.blockers.push(`Two real pick lines for one variety on pick ${pickBubbleId}.`);
      continue;
    }

    const palletsPicked = picked ?? 0;
    const tempValue = tempPicked.get(`${pickBubbleId}|${varietyBubbleId}`);
    if (picked === null && tempValue !== undefined && tempValue > 0) {
      report.note("info", "dailypickproduct", line._id, "pick_line.unsaved_edit", `Grower typed ${tempValue} pallets on ${pick.day.tradeDate} but never confirmed — the committed value (empty) is imported.`);
    }

    // Bubble's `leftovers` is the carry-in from the grower's previous day, and
    // "the number of leftover pallets after the day ended" is picked +
    // carry-in − arranged — the same two meanings leftover_pallets has in
    // migration 0050: the carry-in while a day is open, the end-of-day figure
    // once it has closed.
    const carryIn = numberValue(line, "leftovers") ?? 0;
    const arranged = arrangedByBubblePickLine.get(line._id) ?? 0;
    const endOfDay = numberValue(line, "the number of leftover pallets after the day ended");
    let leftover: number;
    if (pick.day.phase !== "closed") {
      leftover = carryIn;
    } else if (pick.day.bubbleClosed && endOfDay !== null) {
      leftover = endOfDay;
    } else {
      leftover = palletsPicked + carryIn - arranged;
      if (pick.day.bubbleClosed) {
        report.note("warning", "dailypickproduct", line._id, "pick_line.no_end_of_day", `Closed day ${pick.day.tradeDate} has no end-of-day leftover — computed ${leftover}.`);
      }
    }
    if (leftover < 0) {
      report.note("warning", "dailypickproduct", line._id, "pick_line.negative_leftover", `Leftover ${leftover} on ${pick.day.tradeDate} is negative — imported as-is.`);
    }
    if (arranged > palletsPicked + carryIn) {
      report.note("warning", "dailypickproduct", line._id, "pick_line.over_arranged", `${arranged} pallets arranged but only ${palletsPicked} picked + ${carryIn} carried in on ${pick.day.tradeDate} — imported as in Bubble.`);
    }

    const id = randomUUID();
    rows.daily_pick_products.push({
      id,
      daily_pick_id: pick.id,
      product_variety_id: varietyId,
      pallets_picked: palletsPicked,
      comment: text(line, "Comment"),
      leftover_pallets: leftover,
      created_at: createdAt(line),
      updated_at: modifiedAt(line),
    });
    const ref: PickLineRef = { id, day: pick.day, varietyId };
    pickLineByBubbleId.set(line._id, ref);
    pickLineByPickVariety.set(key, ref);
    idMap.push({ bubble_id: line._id, entity_type: "dailypickproduct", new_id: id });
  }

  // ---- orders
  const orderByBubbleId = new Map<string, OrderRef>();
  const orderByDayCustomer = new Map<string, OrderRef>();
  for (const order of data.dailyorder) {
    const bubbleStatus = text(order, "Status");
    const status = lookup(ORDER_STATUSES, bubbleStatus, "dailyorder.Status");
    if (bubbleStatus !== null && status === null) continue;
    // An order's own shop link is the most direct evidence of its day; the
    // date rule covers the orders that have none.
    const shopBubbleId = text(order, "linked to daily shop");
    const day = (shopBubbleId ? dayByShopBubbleId.get(shopBubbleId) : undefined) ?? dayFor(text(order, "Date"), createdAt(order));
    if (!day) {
      report.note("warning", "dailyorder", order._id, "order.no_trading_day", "No trading day for its shop or date — not imported.");
      continue;
    }
    const customerBubbleId = text(order, "link to company (customer)");
    const customerId = customerBubbleId ? reference.companyIdByBubbleId.get(customerBubbleId) : undefined;
    if (!customerId) {
      report.note("warning", "dailyorder", order._id, "order.customer_missing", "Its customer was not imported — not imported.");
      continue;
    }
    if (status === null) {
      report.note("warning", "dailyorder", order._id, "order.no_status", "No status — not imported.");
      continue;
    }
    const key = `${day.id}|${customerId}`;
    if (orderByDayCustomer.has(key)) {
      report.blockers.push(`Two orders for one customer on trading day ${day.tradeDate} (order ${order._id}).`);
      continue;
    }
    const comment = text(order, "comment");
    if (comment) {
      // Kept here in full, since daily_orders has no column for it.
      report.note("warning", "dailyorder", order._id, "order.comment_not_imported", `Order-level comment on ${day.tradeDate} has no column in this schema: "${comment}"`);
    }
    const id = randomUUID();
    rows.daily_orders.push({
      id,
      trading_day_id: day.id,
      customer_company_id: customerId,
      status,
      submitted_at: text(order, "Submission Time"),
      created_at: createdAt(order),
      updated_at: modifiedAt(order),
    });
    const ref: OrderRef = { id, day, customerId };
    orderByBubbleId.set(order._id, ref);
    orderByDayCustomer.set(key, ref);
    idMap.push({ bubble_id: order._id, entity_type: "dailyorder", new_id: id });
  }

  // ---- order lines, first pass: candidates
  const lineByOrderVariety = new Map<string, OrderLineCandidate>();
  let blankPlaceholders = 0;
  for (const line of data.dailyorderproducts) {
    const orderBubbleId = text(line, "linked to daily order");
    const pallets = numberValue(line, "No. of pallets (new)");
    if (!orderBubbleId) {
      // Bubble pre-creates one empty line per customer and variety that is
      // never attached to an order; these hold no quantity.
      if (pallets !== null && pallets > 0) {
        report.blockers.push(`Order line ${line._id} has ${pallets} pallets but no order.`);
      } else {
        blankPlaceholders++;
      }
      continue;
    }
    const order = orderByBubbleId.get(orderBubbleId);
    if (!order) {
      report.note("warning", "dailyorderproducts", line._id, "order_line.order_missing", `Its order was not imported (pallets: ${pallets ?? "empty"}) — not imported.`);
      continue;
    }
    const varietyBubbleId = text(line, "linked to product variety");
    const varietyId = varietyBubbleId ? reference.varietyIdByBubbleId.get(varietyBubbleId) : undefined;
    if (!varietyId) {
      report.note("warning", "dailyorderproducts", line._id, "order_line.variety_missing", `Its product variety no longer exists (pallets: ${pallets ?? "empty"}) — not imported.`);
      continue;
    }
    const key = `${order.id}|${varietyId}`;
    if (lineByOrderVariety.has(key)) {
      report.blockers.push(`Two order lines for one variety on order ${orderBubbleId}.`);
      continue;
    }
    lineByOrderVariety.set(key, {
      id: randomUUID(),
      order,
      varietyId,
      pallets: pallets !== null && pallets > 0 ? pallets : 0,
      comment: text(line, "Comment"),
      createdAt: createdAt(line),
      updatedAt: modifiedAt(line),
      bubbleId: line._id,
      neededByArrangement: false,
    });
  }
  report.note("info", "dailyorderproducts", null, "order_line.blank_placeholders", `${blankPlaceholders} blank order-line placeholders (no order, no quantity) skipped.`);

  // ---- arrangement records
  // Bubble links a record to a pick line and a customer company, never to an
  // order line (docs/DATA_MIGRATION_PLAN.md § 3c). Its order line is the
  // customer's line for that variety on that day — the order's natural key
  // makes that unique. Where the customer never ordered the variety, the
  // record gets a zero-pallet line, exactly what arrange_to_customer
  // (migration 0040) creates when the distributor pushes stock to a customer.
  for (const record of data.dailyarrangementrecords) {
    const quantity = numberValue(record, "Number Pallets Arranged");
    if (quantity === null || quantity <= 0) {
      report.note("info", "dailyarrangementrecords", record._id, "record.no_quantity", `Arrangement record with ${quantity ?? "no"} pallets — nothing arranged; not imported.`);
      continue;
    }
    let pickLine = pickLineByBubbleId.get(text(record, "linked to daily pick product") ?? "");
    if (!pickLine) {
      // Fall back to the real twin of the temp copy it points at.
      const temp = data.dailypickproduct.find((line) => line._id === text(record, "linked to daily pick product (temp record)"));
      const pick = temp ? pickByBubbleId.get(text(temp, "linked to daily pick") ?? "") : undefined;
      const varietyId = temp ? reference.varietyIdByBubbleId.get(text(temp, "linked to product variety") ?? "") : undefined;
      pickLine = pick && varietyId ? pickLineByPickVariety.get(`${pick.id}|${varietyId}`) : undefined;
    }
    if (!pickLine) {
      report.note("warning", "dailyarrangementrecords", record._id, "record.pick_line_missing", `${quantity} pallets arranged, but its pick line was not imported — not imported.`);
      continue;
    }
    const customerBubbleId = text(record, "linked to company (customer)");
    const customerId = customerBubbleId ? reference.companyIdByBubbleId.get(customerBubbleId) : undefined;
    if (!customerId) {
      report.note("warning", "dailyarrangementrecords", record._id, "record.customer_missing", `${quantity} pallets arranged to a customer that was not imported — not imported.`);
      continue;
    }
    const recordVariety = text(record, "linked to product variety");
    if (recordVariety && reference.varietyIdByBubbleId.get(recordVariety) !== pickLine.varietyId) {
      report.note("warning", "dailyarrangementrecords", record._id, "record.variety_mismatch", "Its variety differs from its pick line's — the pick line's variety is used.");
    }
    const linkedArrangement = text(record, "linked to daily arrangement");
    if (linkedArrangement && dayByArrangementBubbleId.get(linkedArrangement) !== pickLine.day) {
      report.blockers.push(`Arrangement record ${record._id} links to a different day than its pick line.`);
      continue;
    }

    let order = orderByDayCustomer.get(`${pickLine.day.id}|${customerId}`);
    if (!order) {
      order = { id: randomUUID(), day: pickLine.day, customerId };
      orderByDayCustomer.set(`${pickLine.day.id}|${customerId}`, order);
      rows.daily_orders.push({
        id: order.id,
        trading_day_id: pickLine.day.id,
        customer_company_id: customerId,
        status: "open",
        submitted_at: null,
        created_at: createdAt(record),
        updated_at: createdAt(record),
      });
      report.note("warning", "dailyarrangementrecords", record._id, "record.order_created", `Customer had no order on ${pickLine.day.tradeDate} but was arranged ${quantity} pallets — an empty open order was created to hold the record.`);
    }
    const lineKey = `${order.id}|${pickLine.varietyId}`;
    let orderLine = lineByOrderVariety.get(lineKey);
    if (!orderLine) {
      orderLine = {
        id: randomUUID(),
        order,
        varietyId: pickLine.varietyId,
        pallets: 0,
        comment: null,
        createdAt: createdAt(record),
        updatedAt: createdAt(record),
        bubbleId: null,
        neededByArrangement: true,
      };
      lineByOrderVariety.set(lineKey, orderLine);
      report.note("info", "dailyarrangementrecords", record._id, "record.zero_line_created", `Customer never ordered this variety on ${pickLine.day.tradeDate} — a zero-pallet order line holds the ${quantity} arranged pallets.`);
    }
    orderLine.neededByArrangement = true;

    const price = parsePrice(text(record, "price"));
    if (price === "invalid") {
      report.note("warning", "dailyarrangementrecords", record._id, "record.price_invalid", `Price "${text(record, "price")}" is not a number — left empty.`);
    }
    const id = randomUUID();
    rows.arrangement_records.push({
      id,
      daily_arrangement_id: pickLine.day.arrangementId,
      daily_pick_product_id: pickLine.id,
      daily_order_product_id: orderLine.id,
      customer_company_id: customerId,
      quantity_pallets: quantity,
      price: price === "invalid" ? null : price,
      price_type: text(record, "price type"),
      created_at: createdAt(record),
      updated_at: modifiedAt(record),
    });
    idMap.push({ bubble_id: record._id, entity_type: "dailyarrangementrecords", new_id: id });
  }

  // ---- order lines, second pass
  // A zero-pallet line only exists in this schema while an arrangement record
  // points at it (submit_order prunes the rest), so those are the only zero
  // lines kept.
  let zeroLinesSkipped = 0;
  for (const line of lineByOrderVariety.values()) {
    if (line.pallets <= 0 && !line.neededByArrangement) {
      zeroLinesSkipped++;
      continue;
    }
    rows.daily_order_products.push({
      id: line.id,
      daily_order_id: line.order.id,
      product_variety_id: line.varietyId,
      pallets_ordered: line.pallets,
      comment: line.comment,
      created_at: line.createdAt,
      updated_at: line.updatedAt,
    });
    if (line.bubbleId) idMap.push({ bubble_id: line.bubbleId, entity_type: "dailyorderproducts", new_id: line.id });
  }
  report.note("info", "dailyorderproducts", null, "order_line.zero_skipped", `${zeroLinesSkipped} order line(s) with 0 or no pallets and no arrangement skipped.`);

  // ---- order submission logs
  // Bubble's "order logs" list is v1.3's submission history — the same event
  // order_submission_logs records, in the same snapshot shape submit_order
  // writes: [{ productVarietyId, palletsOrdered, comment }].
  for (const order of data.dailyorder) {
    const planned = orderByBubbleId.get(order._id);
    if (!planned) continue;
    for (const entry of idList(order, "order logs")) {
      const parsed = parseOrderLog(entry);
      if (!parsed) {
        report.note("warning", "dailyorder", order._id, "order_log.unparseable", "An order-log entry could not be parsed — not imported.");
        continue;
      }
      const submittedBy = loginFor(parsed.userBubbleId);
      if (!submittedBy) {
        report.note("warning", "dailyorder", order._id, "order_log.submitter_missing", "An order-log entry's submitter is not an imported login — not imported.");
        continue;
      }
      const snapshot: Array<{ productVarietyId: string; palletsOrdered: number; comment: string | null }> = [];
      for (const line of parsed.lines) {
        const varietyId = reference.varietyIdByBubbleId.get(line.varietyBubbleId);
        // An empty quantity in Bubble's log means no pallets were entered for
        // that variety — recorded as 0 rather than dropped from the snapshot.
        const pallets = line.order === "" ? 0 : Number(line.order);
        if (!varietyId || !Number.isFinite(pallets)) {
          report.note("warning", "dailyorder", order._id, "order_log.line_unmapped", `An order-log line (variety ${line.varietyBubbleId}, "${line.order}") could not be mapped — left out of that snapshot.`);
          continue;
        }
        snapshot.push({ productVarietyId: varietyId, palletsOrdered: pallets, comment: line.comment || null });
      }
      rows.order_submission_logs.push({ id: randomUUID(), daily_order_id: planned.id, submitted_by: submittedBy, snapshot, created_at: parsed.date });
    }
  }

  // ---- lifecycle sessions
  let sessionsFallback = 0;
  for (const session of data.session) {
    const bubbleType = text(session, "session type");
    const sessionType = lookup(SESSION_TYPES, bubbleType, "session.session type");
    if (bubbleType !== null && sessionType === null) continue;
    if (sessionType === null) {
      report.note("warning", "session", session._id, "session.no_type", "No session type — not imported.");
      continue;
    }
    const created = createdAt(session);
    let day: Day | undefined;
    if (bubbleType === "initiate day") {
      // Bubble logs "initiate day" a few seconds BEFORE it creates that day's
      // arrangement, so it belongs to the day created just after it.
      day = days.find((candidate) => {
        const gap = Date.parse(candidate.created) - Date.parse(created);
        return gap >= 0 && gap <= 120_000;
      });
    } else {
      for (const candidate of days) if (candidate.created <= created) day = candidate;
    }
    if (!day) {
      report.note("warning", "session", session._id, "session.no_trading_day", `"${bubbleType}" session has no trading day — not imported.`);
      continue;
    }
    const bubbleUserId = text(session, "user");
    const performedBy = loginFor(bubbleUserId);
    if (!performedBy) sessionsFallback++;
    rows.lifecycle_sessions.push({
      id: randomUUID(),
      trading_day_id: day.id,
      session_type: sessionType,
      performed_by: performedBy ?? fallbackLogin,
      metadata: { importedFromBubble: true, bubbleSessionId: session._id, bubbleUserId, complete: booleanValue(session, "complete"), bubbleDate: text(session, "date") },
      created_at: created,
    });
  }
  if (sessionsFallback > 0) {
    report.note("info", "session", null, "session.performed_by_fallback", `${sessionsFallback} session(s) by a login that was not imported — credited to the assigned distributor.`);
  }
  if (createdBeforeEveryDay > 0) {
    report.note("info", "dailyarrangement", null, "day.created_before_every_day", `${createdBeforeEveryDay} record(s) on a re-initiated date were created before any of that date's days — given to the first.`);
  }

  // ---- notification templates (the source's `main alert`)
  // Imported for the record, under their own keys; no trigger reads them —
  // each has a purpose-built equivalent already (docs/DATA_MIGRATION_PLAN.md § 3b).
  for (const alert of data.mainalert) {
    const alertId = text(alert, "id");
    const rawContent = alert["alert content"];
    const content = typeof rawContent === "string" && rawContent.trim() !== "" ? rawContent : null;
    const bubbleChannel = text(alert, "notification type");
    const channel = lookup(NOTIFICATION_CHANNELS, bubbleChannel, "mainalert.notification type");
    if (bubbleChannel !== null && channel === null) continue;
    if (!alertId || !content || !channel) {
      report.note("warning", "mainalert", alert._id, "template.incomplete", "Missing id, content or channel — not imported.");
      continue;
    }
    const id = randomUUID();
    rows.notification_templates.push({
      id,
      template_key: `${TEMPLATE_KEY_PREFIX}${alertId}`,
      channel,
      title: text(alert, "title"),
      content,
      link: text(alert, "link"),
      created_at: createdAt(alert),
      updated_at: modifiedAt(alert),
    });
    idMap.push({ bubble_id: alert._id, entity_type: "mainalert", new_id: id });
  }

  // ---- what has no home in this schema
  report.note("info", "appsettings", null, "not_imported", `App settings not imported — replaced by trading_days.phase and notification_settings (Bubble toggles were: whatsapp ${text(appSettings, "whatsapp toggle")}, closing-day messages ${text(appSettings, "whatsapp toggle (messages to customers when closing the day)")}, open-shop ${text(appSettings, "open shop toggle")}, initiate-day ${text(appSettings, "initiate business day whatsapp notification toggle")}).`);
  for (const type of ["dailycheckingofemptyorders", "customer", "dailyshopproduct", "alerts", "alerttypes"] as const) {
    if (data[type].length > 0) report.note("info", type, null, "not_imported", `${data[type].length} "${type}" record(s) not imported — no equivalent table.`);
  }
  report.fieldsNotImported("dailyorder", data.dailyorder, ["activity history", "actively editing", "processing?", "processing date", "last editing date"], "editing/locking state with no equivalent");
  report.fieldsNotImported("dailypick", data.dailypick, ["activity history"], "no equivalent column");
  report.fieldsNotImported("dailyshop", data.dailyshop, ["out of stock products", "list of products that has been notified to distributors when all picked products are ordered"], "this app computes stock live instead");
  report.fieldsNotImported("dailyorderproducts", data.dailyorderproducts, ["price type", "price type text", "price value (fixed)", "price value (range)", "Actual Pallets Received"], "no column for it in daily_order_products");
  report.fieldsNotImported("dailyarrangementrecords", data.dailyarrangementrecords, ["Time"], "created_at already records when it was arranged");

  return { rows, idMap, liveDay: days.find((day) => day.isLive) ?? null };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
// postgres.js types a bulk-insert helper's row values as SQL parameters. The
// plan builds rows as plain records, so batches are cast at the insert.
type SqlRow = Record<string, postgres.ParameterOrJSON<never>>;

// Tables this import empties before writing. notification_templates is
// handled separately (only this import's own prefixed rows are replaced).
const WIPED_TABLES = [
  "arrangement_records",
  "order_submission_logs",
  "daily_order_products",
  "daily_orders",
  "daily_pick_products",
  "daily_picks",
  "daily_shops",
  "lifecycle_sessions",
  "notification_outbox",
  "daily_arrangements",
  "trading_days",
  "alerts",
  "product_customer_caps",
  "profile_blocked_products",
  "grower_products",
  "profiles",
  "companies",
  "product_varieties",
  "product_families",
  "_bubble_migration_log",
  "_bubble_migration_id_map",
] as const;

async function writeBackup(sql: Sql): Promise<string> {
  const backup: Record<string, unknown> = { takenAt: new Date().toISOString() };
  for (const table of [...WIPED_TABLES, "notification_templates"]) {
    backup[`public.${table}`] = await sql`select * from ${sql(table)}`;
  }
  backup["auth.users"] = await sql`select * from auth.users`;
  backup["auth.identities"] = await sql`select * from auth.identities`;
  await mkdir(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `before-bubble-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(backup, null, 2));
  return file;
}

async function insertRows(tx: Tx, table: TableName, rows: Row[]) {
  const columns = COLUMNS[table] as readonly string[];
  for (const row of rows) {
    const keys = Object.keys(row);
    if (keys.length !== columns.length || !columns.every((column) => column in row)) {
      throw new Error(`Planned ${table} row has columns [${keys.join(", ")}], expected [${columns.join(", ")}].`);
    }
  }
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE).map((row) => {
      const copy: Row = { ...row };
      for (const column of columns) {
        if (JSON_COLUMNS.has(column)) copy[column] = tx.json(row[column] as postgres.JSONValue);
      }
      return copy;
    });
    await tx`insert into ${tx(table)} ${tx(batch as SqlRow[], ...columns)}`;
  }
}

const sumOf = (rows: Row[], column: string) => Math.round(rows.reduce((total, row) => total + Number(row[column] ?? 0), 0) * 100) / 100;

async function verify(tx: Tx, reference: ReferencePlan, plan: TradingPlan) {
  const expected = new Map<string, number>([
    ["companies", reference.companies.length],
    ["product_families", reference.productFamilies.length],
    ["product_varieties", reference.productVarieties.length],
    ["grower_products", reference.growerProducts.length],
  ]);
  for (const table of TABLE_ORDER) {
    if (!expected.has(table) && table !== "notification_templates") expected.set(table, plan.rows[table].length);
  }
  for (const [table, count] of expected) {
    const [row] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)}`;
    if (row?.n !== count) throw new Error(`Verification failed: ${table} has ${row?.n} rows, planned ${count}.`);
  }
  const [templates] = await tx<{ n: number }[]>`select count(*)::int as n from notification_templates where template_key like ${`${TEMPLATE_KEY_PREFIX}%`}`;
  if (templates?.n !== plan.rows.notification_templates.length) throw new Error("Verification failed: imported notification_templates count.");

  const [logins] = await tx<{ n: number }[]>`select count(*)::int as n from auth.users`;
  if (logins?.n !== reference.users.length) throw new Error(`Verification failed: auth.users has ${logins?.n} rows, expected ${reference.users.length}.`);

  const [open] = await tx<{ n: number }[]>`select count(*)::int as n from trading_days where phase <> 'closed'`;
  if (open?.n !== (plan.liveDay ? 1 : 0)) throw new Error(`Verification failed: ${open?.n} non-closed trading days.`);

  // Totals catch a value silently lost in conversion, which a row count can't.
  const totals: Array<[string, string, number]> = [
    ["daily_pick_products", "pallets_picked", sumOf(plan.rows.daily_pick_products, "pallets_picked")],
    ["daily_pick_products", "leftover_pallets", sumOf(plan.rows.daily_pick_products, "leftover_pallets")],
    ["daily_order_products", "pallets_ordered", sumOf(plan.rows.daily_order_products, "pallets_ordered")],
    ["arrangement_records", "quantity_pallets", sumOf(plan.rows.arrangement_records, "quantity_pallets")],
  ];
  for (const [table, column, planned] of totals) {
    const [row] = await tx<{ total: string }[]>`select coalesce(sum(${tx(column)}), 0)::text as total from ${tx(table)}`;
    if (Number(row?.total) !== planned) throw new Error(`Verification failed: sum(${table}.${column}) is ${row?.total}, planned ${planned}.`);
  }

  // Relationships the app relies on that no foreign key enforces. Each query
  // counts the rows breaking one; every count must be zero.
  const invariants: Array<[string, () => PromiseLike<Array<{ n: number }>>]> = [
    [
      "an arrangement record's customer is its order line's customer",
      () => tx`
        select count(*)::int as n from arrangement_records ar
        join daily_order_products dop on dop.id = ar.daily_order_product_id
        join daily_orders o on o.id = dop.daily_order_id
        where o.customer_company_id <> ar.customer_company_id`,
    ],
    [
      "an arrangement record, its pick line and its order line are on one trading day",
      () => tx`
        select count(*)::int as n from arrangement_records ar
        join daily_arrangements da on da.id = ar.daily_arrangement_id
        join daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
        join daily_picks dp on dp.id = dpp.daily_pick_id
        join daily_order_products dop on dop.id = ar.daily_order_product_id
        join daily_orders o on o.id = dop.daily_order_id
        where da.trading_day_id <> dp.trading_day_id or dp.trading_day_id <> o.trading_day_id`,
    ],
    [
      "an arrangement record's pick line and order line are the same variety",
      () => tx`
        select count(*)::int as n from arrangement_records ar
        join daily_pick_products dpp on dpp.id = ar.daily_pick_product_id
        join daily_order_products dop on dop.id = ar.daily_order_product_id
        where dpp.product_variety_id <> dop.product_variety_id`,
    ],
    [
      "a zero-pallet order line exists only while an arrangement record points at it",
      () => tx`
        select count(*)::int as n from daily_order_products dop
        where dop.pallets_ordered <= 0
          and not exists (select 1 from arrangement_records ar where ar.daily_order_product_id = dop.id)`,
    ],
    [
      "every trading day has its daily arrangement",
      () => tx`
        select count(*)::int as n from trading_days td
        where not exists (select 1 from daily_arrangements da where da.trading_day_id = td.id)`,
    ],
    [
      "a closed trading day's arrangement, shop and picks are all closed",
      () => tx`
        select (
          (select count(*) from daily_picks dp join trading_days td on td.id = dp.trading_day_id where td.phase = 'closed' and dp.status <> 'closed')
          + (select count(*) from daily_arrangements da join trading_days td on td.id = da.trading_day_id where td.phase = 'closed' and da.status <> 'closed')
          + (select count(*) from daily_shops ds join trading_days td on td.id = ds.trading_day_id where td.phase = 'closed' and ds.status <> 'closed')
        )::int as n`,
    ],
    [
      "a shop is open exactly when its trading day is in phase shop_open",
      () => tx`
        select count(*)::int as n from daily_shops ds
        join trading_days td on td.id = ds.trading_day_id
        where (td.phase = 'shop_open') <> (ds.status = 'open')`,
    ],
    [
      "picks belong to grower companies and orders to customer companies",
      () => tx`
        select (
          (select count(*) from daily_picks dp join companies c on c.id = dp.grower_company_id where c.type <> 'grower')
          + (select count(*) from daily_orders o join companies c on c.id = o.customer_company_id where c.type <> 'customer')
        )::int as n`,
    ],
    [
      "every login has a profile",
      () => tx`
        select count(*)::int as n from auth.users u
        where not exists (select 1 from profiles p where p.user_id = u.id)`,
    ],
    [
      "an active backoffice company exists for backoffice notifications",
      () => tx`
        select case when exists (select 1 from companies where type = 'backoffice' and status = 'active') then 0 else 1 end as n`,
    ],
  ];
  for (const [description, query] of invariants) {
    const [row] = await query();
    if (row?.n !== 0) throw new Error(`Verification failed: ${row?.n} row(s) break "${description}".`);
  }
  console.log(`\n${invariants.length} cross-table checks passed.`);
}

class DryRunRollback extends Error {}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printIssues(issues: Issue[]) {
  const groups = new Map<string, { severity: Severity; code: string; count: number; example: string }>();
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.code}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { severity: issue.severity, code: issue.code, count: 1, example: issue.message });
  }
  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  for (const group of [...groups.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count)) {
    console.log(`  ${group.severity.padEnd(7)} ${String(group.count).padStart(6)}  ${group.code} — e.g. ${group.example}`);
  }
}

async function main() {
  const { data, exportedAt } = await loadExport();
  console.log(`${COMMIT ? "COMMIT RUN" : "DRY RUN (rolled back at the end — pass --commit to import for real)"}`);
  console.log(`Source: Bubble ${BUBBLE_ENV} export taken ${exportedAt}\n`);

  // Plan once with stand-in login ids: every check runs before anything is
  // written anywhere, including before any login is created.
  const referenceReport = new Report();
  const reference = planReference(data, referenceReport);
  const standInIds = new Map(reference.users.map((user) => [user.bubbleId, randomUUID()]));
  const firstPassReport = new Report();
  planTrading(data, reference, standInIds, firstPassReport);

  const blockers = [...referenceReport.blockers, ...firstPassReport.blockers];
  for (const [label, values] of unknownOptionValues) {
    blockers.push(`Unmapped option value(s) for ${label}: ${[...values].map((value) => `"${value}"`).join(", ")}`);
  }
  if (blockers.length > 0) {
    throw new Error(`Import stopped before touching anything:\n  - ${blockers.join("\n  - ")}`);
  }

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, idle_timeout: 20, onnotice: () => undefined });
  const createdLoginIds: string[] = [];
  const admin = COMMIT
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

  const deleteCreatedLogins = async () => {
    if (!admin || createdLoginIds.length === 0) return;
    const failed: string[] = [];
    for (const id of createdLoginIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) failed.push(id);
    }
    console.error(failed.length === 0 ? `Removed the ${createdLoginIds.length} login(s) this run created.` : `Could NOT remove ${failed.length} login(s) this run created: ${failed.join(", ")}`);
  };

  try {
    if (COMMIT) console.log(`Backup of the current data written to ${await writeBackup(sql)}\n`);

    // ---- logins
    const emails = reference.users.map((user) => user.email);
    const existing = await sql<{ id: string; email: string }[]>`
      select id, lower(email) as email from auth.users
      where lower(email) in (select jsonb_array_elements_text(${sql.json(emails)}))
    `;
    const existingByEmail = new Map(existing.map((row) => [row.email, row.id]));
    const loginIds = new Map<string, string>();
    const standIns: Array<{ id: string; email: string }> = [];
    const loginReport = new Report();
    for (const user of reference.users) {
      const existingId = existingByEmail.get(user.email);
      if (existingId) {
        loginIds.set(user.bubbleId, existingId);
        loginReport.note("warning", "user", user.bubbleId, "user.existing_login_reused", `A login for ${user.email} already exists — reused instead of creating a second one.`);
        continue;
      }
      if (!admin) {
        // Dry run: a stand-in auth.users row inside the rolled-back transaction
        // gives profiles' foreign key something real to check against.
        const id = randomUUID();
        standIns.push({ id, email: user.email });
        loginIds.set(user.bubbleId, id);
        continue;
      }
      // A random password nobody ever sees; must_change_password sends the user
      // through a reset, as for every admin-provisioned account.
      const { data: created, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
      });
      if (error || !created.user) throw new Error(`Could not create the login for ${user.email}: ${error?.message ?? "no user returned"}`);
      createdLoginIds.push(created.user.id);
      loginIds.set(user.bubbleId, created.user.id);
    }

    // Plan again with the real login ids — this is the plan that is written.
    const report = new Report();
    const plan = planTrading(data, reference, loginIds, report);
    const issues = [...referenceReport.issues, ...loginReport.issues, ...report.issues];

    console.log("Planned rows:");
    console.table(
      Object.fromEntries(
        TABLE_ORDER.map((table) => [
          table,
          table === "companies" ? reference.companies.length
            : table === "product_families" ? reference.productFamilies.length
              : table === "product_varieties" ? reference.productVarieties.length
                : table === "grower_products" ? reference.growerProducts.length
                  : plan.rows[table].length,
        ]),
      ),
    );
    console.log(plan.liveDay ? `Live day: ${plan.liveDay.tradeDate} in phase ${plan.liveDay.phase}\n` : "No live day — every imported day is closed.\n");
    console.log("Not imported as-is (grouped):");
    printIssues(issues);

    await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '15min'`;
      await tx`set local lock_timeout = '20s'`;
      // Holds off every other writer (a lifecycle action, a running test suite)
      // until this transaction ends; reads keep working.
      await tx`lock table public.trading_days, public.companies, public.profiles, public.product_families, public.product_varieties in share row exclusive mode`;

      // postgres.js serialises a jsonb parameter itself, so these values are
      // passed through tx.json() as plain arrays — pre-stringifying them would
      // send one JSON string instead of an array.
      if (standIns.length > 0) {
        await tx`insert into auth.users (id, email) select id, email from jsonb_to_recordset(${tx.json(standIns)}) as x(id uuid, email text)`;
      }

      // ---- replace: delete the current business data, children first
      console.log("\nDeleting current data:");
      const keepLoginIds = [...loginIds.values()];
      const deleted: Record<string, number> = {};
      for (const table of WIPED_TABLES) {
        if (table === "companies") {
          // Every table referencing a login or a company is already empty at
          // this point, so the logins not being imported can go, and then the
          // companies — after clearing transporter_company_id, which points
          // at companies itself.
          const logins = await tx`delete from auth.users where id not in (select (jsonb_array_elements_text(${tx.json(keepLoginIds)}))::uuid)`;
          deleted["auth.users"] = logins.count;
          await tx`update companies set transporter_company_id = null where transporter_company_id is not null`;
        }
        const result = await tx`delete from ${tx(table)}`;
        deleted[table] = result.count;
      }
      const templates = await tx`delete from notification_templates where template_key like ${`${TEMPLATE_KEY_PREFIX}%`}`;
      deleted.notification_templates = templates.count;
      console.table(deleted);

      // ---- insert
      await insertRows(tx, "companies", reference.companies);
      if (reference.transporterLinks.length > 0) {
        await tx`
          update companies set transporter_company_id = link.transporter_company_id
          from jsonb_to_recordset(${tx.json(reference.transporterLinks)}) as link(id uuid, transporter_company_id uuid)
          where companies.id = link.id
        `;
      }
      await insertRows(tx, "profiles", plan.rows.profiles);
      await insertRows(tx, "product_families", reference.productFamilies);
      await insertRows(tx, "product_varieties", reference.productVarieties);
      await insertRows(tx, "grower_products", reference.growerProducts);
      for (const table of TABLE_ORDER.slice(TABLE_ORDER.indexOf("profile_blocked_products"))) {
        await insertRows(tx, table, plan.rows[table]);
      }

      // ---- bookkeeping (migration 0026)
      const idMap = [...reference.idMap, ...plan.idMap];
      for (let start = 0; start < idMap.length; start += BATCH_SIZE) {
        await tx`insert into _bubble_migration_id_map ${tx(idMap.slice(start, start + BATCH_SIZE) as SqlRow[], "bubble_id", "entity_type", "new_id")}`;
      }
      const logRows = issues.map((issue) => ({
        entity_type: issue.entityType,
        bubble_id: issue.bubbleId,
        severity: issue.severity,
        message: `[${issue.code}] ${issue.message}`,
      }));
      for (let start = 0; start < logRows.length; start += BATCH_SIZE) {
        await tx`insert into _bubble_migration_log ${tx(logRows.slice(start, start + BATCH_SIZE), ["entity_type", "bubble_id", "severity", "message"])}`;
      }

      await verify(tx, reference, plan);
      console.log(`\nVerification passed: row counts, logins, single open day and pallet totals all match the plan.`);

      if (!COMMIT) throw new DryRunRollback();
    });

    console.log(`\nCOMMITTED. ${reference.users.length} login(s) imported (${createdLoginIds.length} created) — every one must reset its password before signing in.`);
  } catch (error) {
    if (error instanceof DryRunRollback) {
      console.log("\nDry run finished — everything above was rolled back; the database is unchanged.");
      return;
    }
    await deleteCreatedLogins();
    throw error;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
