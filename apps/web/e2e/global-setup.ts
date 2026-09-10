import { parkOpenTradingDay } from "@ori/domain/lifecycle-engine/testing";

// Playwright globalSetup — the e2e counterpart of the domain suite's own
// (packages/domain/src/lifecycle-engine/global-setup.ts). Both suites target
// the same database and both need the single-open-trading-day slot that
// Lifecycle Invariant 1 allows, so both borrow it the same way.
export default async function globalSetup(): Promise<void> {
  await parkOpenTradingDay();
}
