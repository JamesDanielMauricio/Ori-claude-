import { db } from "@ori/db";
import { restoreParkedTradingDay } from "@ori/domain/lifecycle-engine/testing";

// Hands back the trading-day slot borrowed in global-setup.ts, restoring the
// seeded day to the exact phase it was in before the run.
export default async function globalTeardown(): Promise<void> {
  await restoreParkedTradingDay();
  // Closes the pool those two hooks opened in the runner process — specs run
  // in their own workers with their own pools, so nothing else is using this
  // one by now, and leaving it open holds the process past the last test.
  await db.$client.end();
}
