import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "@ori/db";
import { tradingDays } from "@ori/db/schema";
import { eq, ne } from "drizzle-orm";

// Test-suite support for Lifecycle Invariant 1: at most ONE trading day may
// sit in a non-closed phase, enforced by the partial unique index
// `trading_days_single_open_idx` (0009_lifecycle-schema.sql).
//
// That index is global and is enforced against every writer, trusted
// connection included — a unique index is storage-level, not a policy RLS
// can be told to skip. So a seeded demo day left in `shop_open` occupies the
// only slot the suite has, and every test that opens its own day fails with
// P0004 DAY_ALREADY_OPEN. That is not a flaky test: it is 13 test files
// contending with demo data for one global resource.
//
// Rather than deleting the seeded day (it is a real fixture someone built
// for shop-scale testing), the suite BORROWS the slot: park the day by
// flipping its phase to 'closed' before the run, and put the original phase
// back afterwards.
//
// Why flipping the column directly is safe, and why it is not close_shop():
//   - There is not a single trigger anywhere in packages/db/migrations, so
//     an UPDATE of this column has no side effects of its own. The
//     notification enqueues all live inside the lifecycle RPCs.
//   - close_shop() would also move `daily_shops.status` and enqueue
//     notifications — real state changes that no restore could undo. Parking
//     deliberately touches the one column the index reads and nothing else,
//     which is exactly what makes it reversible.
//
// Crash safety: the original phase is written to disk BEFORE the day is
// parked, and `parkOpenTradingDay` restores any leftover parking from a
// previous crashed run before parking again. A killed run therefore heals on
// the next one rather than leaving the day closed forever.
//
// One slot means one suite at a time: the domain suite and the e2e suite
// must not run concurrently against the same database. That was already true
// before this file existed — both open trading days the invariant permits
// only one of — but the self-heal above sharpens it, since a second suite
// starting mid-run would restore the first suite's parked day underneath it.
// Run them in sequence (`pnpm test && pnpm test:e2e`), which is what CI does.
// Taken from the column rather than spelled out, so this can never drift
// from the enum. It stays the full union including 'closed' even though only
// a non-closed day is ever parked: the value is read from the row and written
// straight back, and narrowing it here would be a cast asserting something
// the query's own WHERE already guarantees.
type TradingDayPhase = (typeof tradingDays.$inferSelect)["phase"];

interface ParkedDay {
  id: string;
  phase: TradingDayPhase;
}

// Anchored to the repo root via this file's own location, NOT process.cwd():
// the domain suite runs from packages/domain and the e2e suite from
// apps/web, and both borrow the same slot in the same database. A cwd-based
// path would give them separate parking records, so an e2e run starting
// while the domain suite's day was parked would record "nothing was open"
// and quietly drop the restore on the floor.
//
// Repo-local rather than the OS temp dir so a crashed run's leftover is
// findable next to the code that wrote it, and under node_modules/ so it
// needs no .gitignore entry.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PARK_FILE = join(REPO_ROOT, "node_modules", ".cache", "ori", "parked-trading-day.json");

async function readParked(): Promise<ParkedDay | null> {
  try {
    return JSON.parse(await readFile(PARK_FILE, "utf8")) as ParkedDay;
  } catch {
    return null;
  }
}

// Puts a previously parked day back into its original phase. Safe to call
// when nothing is parked. Exported for the suites' global teardown.
export async function restoreParkedTradingDay(): Promise<void> {
  const parked = await readParked();
  if (!parked) return;

  // A day the suite failed to clean up would occupy the slot this restore
  // needs, and the resulting unique-violation would surface as an opaque
  // Postgres error at teardown. Naming the offender instead turns it into a
  // fixable report — and leaving PARK_FILE in place means the next run's
  // self-heal tries again once the leak is cleared.
  // The parked day is excluded from this check: if it is already non-closed
  // (a restore that ran twice, or someone reopening it by hand) it is not
  // blocking anything — putting its own phase back is a no-op, not a
  // conflict, and reporting it as a leak would send the reader hunting for a
  // test that never existed.
  const blocking = (
    await db
      .select({ id: tradingDays.id, phase: tradingDays.phase })
      .from(tradingDays)
      .where(ne(tradingDays.phase, "closed"))
  ).filter((day) => day.id !== parked.id);
  if (blocking.length > 0) {
    throw new Error(
      `Cannot restore the parked trading day ${parked.id} to '${parked.phase}': ` +
        `a test left trading day ${blocking[0]!.id} in phase '${blocking[0]!.phase}'. ` +
        `Delete that day, then re-run — the parking record at ${PARK_FILE} is kept so the next run retries.`,
    );
  }

  await db.update(tradingDays).set({ phase: parked.phase }).where(eq(tradingDays.id, parked.id));
  await rm(PARK_FILE, { force: true });
}

// Frees the single-open-day slot for the duration of a test run. Records
// what it parked first, so the day survives a crash. Exported for the
// suites' global setup.
export async function parkOpenTradingDay(): Promise<void> {
  // Heal a previous crashed run before taking a new reading, or the parked
  // day would be re-recorded as already-closed and never come back.
  await restoreParkedTradingDay();

  const [open] = await db
    .select({ id: tradingDays.id, phase: tradingDays.phase })
    .from(tradingDays)
    .where(ne(tradingDays.phase, "closed"))
    .limit(1);
  if (!open) return;

  await mkdir(dirname(PARK_FILE), { recursive: true });
  await writeFile(PARK_FILE, JSON.stringify({ id: open.id, phase: open.phase } satisfies ParkedDay));
  await db.update(tradingDays).set({ phase: "closed" }).where(eq(tradingDays.id, open.id));
}
