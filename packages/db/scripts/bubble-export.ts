// Step 1 of 2 of the Bubble -> Supabase import. READ-ONLY against Bubble:
// downloads every record of every Bubble data type into local JSON files, so
// that step 2 (scripts/import-from-bubble.ts) can be analysed, dry-run and
// re-run against one fixed snapshot instead of a source that keeps changing
// underneath it.
//
// Run from packages/db:
//   pnpm bubble:export                     Bubble test DB (version-test) — the default
//   pnpm bubble:export -- --env live       Bubble live DB
//   pnpm bubble:export -- --with-leftovers also fetch `productleftover` (~97K rows,
//                                          not imported — only useful for spot-checks)
//
// Needs BUBBLE_API_TOKEN in the root .env (Bubble editor -> Settings -> API ->
// API Tokens). Writes to packages/db/.bubble-export/<env>/, which is
// gitignored: it holds real people's emails and phone numbers.

import { mkdir, rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "../../..");

try {
  // Node's own .env parser. Variables already set in the shell win.
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch {
  // No root .env — rely on whatever the shell exported.
}

const args = process.argv.slice(2);
const envFlagIndex = args.indexOf("--env");
const BUBBLE_ENV = envFlagIndex === -1 ? "test" : args[envFlagIndex + 1];
if (BUBBLE_ENV !== "test" && BUBBLE_ENV !== "live") {
  throw new Error(`--env must be "test" or "live", got "${BUBBLE_ENV}"`);
}
const WITH_LEFTOVERS = args.includes("--with-leftovers");

const BUBBLE_API_TOKEN = process.env.BUBBLE_API_TOKEN ?? "";
if (!BUBBLE_API_TOKEN) {
  throw new Error("BUBBLE_API_TOKEN is not set — add it to the root .env (Bubble editor -> Settings -> API -> API Tokens).");
}

// The app's own domain, as reported by the Bubble Data API's schema
// endpoint (`app_data.domain`). Bubble serves the test database under the
// `/version-test` path prefix of the same domain.
const BUBBLE_DOMAIN = "app.harpazmarketing.com";
const BASE_URL = `https://${BUBBLE_DOMAIN}${BUBBLE_ENV === "test" ? "/version-test" : ""}/api/1.1/obj`;

const OUTPUT_DIR = path.resolve(scriptsDir, "..", ".bubble-export", BUBBLE_ENV);

// Every type the Data API exposes (its `get` list). The empty ones are
// exported too, so the snapshot itself proves they were empty at export time.
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
  ...(WITH_LEFTOVERS ? ["productleftover"] : []),
];

// Fields dropped before anything touches the disk. `created pass` is a
// plaintext password Bubble stored on the user record; the WhatsApp fields
// are live Green API credentials. Neither is needed by the import, and
// neither should end up in a file on this machine.
const REDACTED_FIELDS: Record<string, string[]> = {
  user: ["created pass"],
  appsettings: ["api_token (whatsapp)", "id_instance (whatsapp)", "api_number (whatsapp)"],
};

// Bubble caps a page at 100 records. Paging is done in windows of at most
// WINDOW_SIZE records ordered by Created Date: once a window is used up, the
// next one starts from the last Created Date seen, instead of pushing the
// cursor into the tens of thousands — deep cursors are exactly where the
// Data API is known to stop returning results.
const PAGE_SIZE = 100;
const WINDOW_SIZE = 10_000;
const MAX_ATTEMPTS = 6;
const CONCURRENT_TYPES = 3;

interface BubbleRecord {
  _id: string;
  "Created Date": string;
  [field: string]: unknown;
}

interface BubblePage {
  cursor: number;
  results: BubbleRecord[];
  count: number;
  remaining: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Anything Bubble echoes back in an error body is printed; make sure the
// token can never be part of it.
const redactToken = (text: string) => text.split(BUBBLE_API_TOKEN).join("***");

async function fetchPage(dataType: string, params: URLSearchParams): Promise<BubblePage> {
  const url = `${BASE_URL}/${dataType}?${params.toString()}`;
  let lastFailure = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${BUBBLE_API_TOKEN}` } });
    } catch (error) {
      lastFailure = `network error: ${(error as Error).message}`;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) {
      const body = (await response.json()) as { response?: BubblePage };
      if (!body.response || !Array.isArray(body.response.results)) {
        throw new Error(`Bubble ${dataType}: unexpected response shape`);
      }
      return body.response;
    }
    lastFailure = `HTTP ${response.status}: ${redactToken((await response.text()).slice(0, 300))}`;
    // Rate limiting and server errors can clear up; a bad token or an
    // unknown data type will not, so stop immediately on any other 4xx.
    if (response.status !== 429 && response.status < 500) break;
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`Bubble ${dataType} request failed after retries (${lastFailure})`);
}

async function exportDataType(dataType: string): Promise<BubbleRecord[]> {
  // What Bubble says the full count is, before paging starts. Checked
  // against what paging actually collected at the end.
  const probe = await fetchPage(dataType, new URLSearchParams({ limit: "1" }));
  const expected = probe.count + probe.remaining;

  const byId = new Map<string, BubbleRecord>();
  let createdAfter: string | null = null;

  for (;;) {
    let cursor = 0;
    let lastCreated: string | null = null;
    let exhausted = false;

    while (cursor < WINDOW_SIZE) {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        cursor: String(cursor),
        sort_field: "Created Date",
        descending: "false",
      });
      if (createdAfter) {
        params.set(
          "constraints",
          JSON.stringify([{ key: "Created Date", constraint_type: "greater than", value: createdAfter }]),
        );
      }
      const page = await fetchPage(dataType, params);
      for (const record of page.results) {
        byId.set(record._id, record);
        lastCreated = record["Created Date"];
      }
      cursor += page.results.length;
      if (page.remaining === 0 || page.results.length === 0) {
        exhausted = true;
        break;
      }
    }
    if (exhausted) break;

    // Restart 1 ms before the last timestamp seen, not at it: records that
    // share that exact Created Date but hadn't been returned yet would
    // otherwise be skipped. The overlap this creates is removed by `byId`.
    if (!lastCreated) throw new Error(`${dataType}: a full window came back without a Created Date`);
    const next: string = new Date(Date.parse(lastCreated) - 1).toISOString();
    if (createdAfter !== null && next <= createdAfter) {
      throw new Error(`${dataType}: more than ${WINDOW_SIZE} records share one Created Date — cannot page past it safely`);
    }
    createdAfter = next;
  }

  if (byId.size !== expected) {
    throw new Error(
      `${dataType}: collected ${byId.size} unique records but Bubble reported ${expected}. ` +
        "Either the data changed during the export (someone using the app) or paging skipped records — re-run the export.",
    );
  }

  const redacted = REDACTED_FIELDS[dataType] ?? [];
  const records = [...byId.values()].map((record) => {
    const copy = { ...record };
    for (const field of redacted) delete copy[field];
    return copy;
  });
  records.sort((a, b) => a["Created Date"].localeCompare(b["Created Date"]) || a._id.localeCompare(b._id));
  return records;
}

async function main() {
  console.log(`Exporting Bubble ${BUBBLE_ENV} (${BASE_URL}) -> ${OUTPUT_DIR}`);

  // Everything lands in a sibling ".partial" directory first and only
  // replaces the previous export once every type has succeeded, so the
  // importer can never read a half-finished snapshot.
  const partialDir = `${OUTPUT_DIR}.partial`;
  await rm(partialDir, { recursive: true, force: true });
  await mkdir(partialDir, { recursive: true });

  const counts: Record<string, number> = {};
  const queue = [...DATA_TYPES];
  const worker = async () => {
    for (let dataType = queue.shift(); dataType; dataType = queue.shift()) {
      const started = Date.now();
      const records = await exportDataType(dataType);
      await writeFile(path.join(partialDir, `${dataType}.json`), JSON.stringify(records));
      counts[dataType] = records.length;
      console.log(`  ${dataType}: ${records.length} records (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENT_TYPES }, worker));

  const manifest = {
    bubbleEnv: BUBBLE_ENV,
    baseUrl: BASE_URL,
    exportedAt: new Date().toISOString(),
    counts: Object.fromEntries(DATA_TYPES.map((type) => [type, counts[type]])),
    redactedFields: REDACTED_FIELDS,
  };
  await writeFile(path.join(partialDir, "_manifest.json"), JSON.stringify(manifest, null, 2));

  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await rename(partialDir, OUTPUT_DIR);
  console.log("Done.", manifest.counts);
}

main().catch((error: unknown) => {
  console.error(redactToken(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exitCode = 1;
});
