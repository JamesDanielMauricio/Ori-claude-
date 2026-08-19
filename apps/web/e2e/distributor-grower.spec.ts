import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { initiateBusinessDayInputSchema, toInitiateBusinessDayRpcArgs } from "@ori/domain/lifecycle-engine";
import {
  createTestGrowerWithProduct,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
} from "@ori/domain/lifecycle-engine/testing";
import { expect, test } from "@playwright/test";

// Drives the distributor's Grower Inventory Status oversight screen
// end to end: the same PickLinesEditor the grower's own screen uses, now
// under a backoffice session editing on the grower's behalf. As with
// grower-picks.spec.ts, the trading day is opened headlessly via the real
// initiate_business_day RPC since there is no backoffice UI for that yet.
test.describe("Backoffice — Grower Inventory Status", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("a distributor edits a grower's pick line on their behalf, and the change persists across a reload", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));

    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    const adminClient = await signInTestUser(admin.email, admin.password);

    const { data: companyRow, error: companyError } = await adminClient
      .from("companies")
      .select("name")
      .eq("id", grower.companyId)
      .single();
    if (companyError) throw companyError;
    const growerName = companyRow.name;

    const tradeDate = new Date().toISOString().slice(0, 10);
    const input = initiateBusinessDayInputSchema.parse({ tradeDate });
    const { data, error } = await adminClient.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs(input));
    if (error) throw error;
    const dayId = data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/distributor-grower");
    const growerRow = page.getByRole("button", { name: new RegExp(growerName) });
    await expect(growerRow).toBeVisible();
    await growerRow.click();

    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "ערוך", exact: true }).click();

    const palletsInput = page.locator('input[type="number"]');
    const commentInput = page.locator('input[type="text"]');
    await palletsInput.fill("8.25");
    await commentInput.fill("distributor-entered note");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("השורות נשמרו.")).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: new RegExp(growerName) }).click();
    await expect(palletsInput).toHaveValue("8.25");
    await expect(commentInput).toHaveValue("distributor-entered note");
  });
});
