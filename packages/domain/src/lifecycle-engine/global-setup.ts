import { db } from "@ori/db";

import { parkOpenTradingDay, restoreParkedTradingDay } from "./trading-day-slot";

// Vitest globalSetup: runs once around the whole domain suite, outside any
// individual test file. Frees the single-open-trading-day slot that
// Lifecycle Invariant 1 allows (see trading-day-slot.ts for why a seeded
// demo day otherwise fails every test that opens one) and hands it back
// afterwards.
export async function setup(): Promise<void> {
  await parkOpenTradingDay();
}

export async function teardown(): Promise<void> {
  await restoreParkedTradingDay();
  // These two hooks are the only DB work that happens in the runner process
  // itself — every test file runs in a worker with its own pool. That pool
  // is idle but open once the restore above finishes, and an open handle
  // here is what makes vitest report "something prevents Vite server from
  // exiting" and sit through its 10s close timeout on every run. The workers
  // are already gone by now, so closing it costs nothing.
  await db.$client.end();
}
