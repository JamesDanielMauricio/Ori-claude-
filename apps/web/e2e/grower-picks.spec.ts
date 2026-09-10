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
  getDailyPickForGrower,
} from "@ori/domain/lifecycle-engine/testing";
import { expect, test } from "@playwright/test";

// Drives the grower's own daily picking screen through the browser end to
// end. The trading day itself is opened headlessly via the real
// initiate_business_day RPC (there is no backoffice UI for that yet — see
// docs/ARCHITECTURE.md's lifecycle engine section) so this test still
// exercises the real bootstrap_grower_pick path the screen depends on, not
// a hand-inserted row.
test.describe("Grower — daily picking input", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  async function openTodayFor(growerCompanyId: string): Promise<string> {
    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    const tradeDate = new Date().toISOString().slice(0, 10);
    const input = initiateBusinessDayInputSchema.parse({ tradeDate });
    const { data, error } = await adminClient.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs(input));
    if (error) throw error;
    const dayId = data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));

    const pick = await getDailyPickForGrower(dayId, growerCompanyId);
    if (!pick) throw new Error("grower's pick was not bootstrapped by initiate_business_day");
    return pick.id;
  }

  test("a grower edits a pick line's pallets, pickup time, and comment, and the change persists across a reload", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    await openTodayFor(grower.companyId);

    const growerUser = await createTestProfile({ companyId: grower.companyId, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerUser.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(growerUser.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(growerUser.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/grower\/picks$/);

    // No "ערוך" gate: the fields are live the moment the editor mounts
    // (pick-lines-editor.tsx dropped the per-session edit gate).
    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toHaveCount(0);

    const palletsInput = page.locator('input[type="number"]');
    const pickupInput = page.locator('input[type="time"]');
    const commentInput = page.locator('input[type="text"]');

    await palletsInput.fill("12.5");
    await pickupInput.fill("09:15");
    await commentInput.fill("gate code 4321");
    await page.getByRole("button", { name: "שמור" }).click();

    await expect(page.getByText("השורות נשמרו.")).toBeVisible();

    await page.reload();
    // <input type="number"> normalizes its DOM value (strips insignificant
    // trailing zeros) regardless of the exact string the numeric(10,2)
    // column round-trips as — "12.5" here, not "12.50".
    await expect(palletsInput).toHaveValue("12.5");
    await expect(pickupInput).toHaveValue("09:15");
    await expect(commentInput).toHaveValue("gate code 4321");

    // The pick history list (routes/grower/history.tsx), the grower-module
    // counterpart of the customer's order history. This pick was only saved,
    // never submitted, so it's still "טיוטה" — same badge picks.tsx itself
    // shows.
    await page.goto("/grower/history");
    const historyRow = page.getByRole("button", { name: "טיוטה" });
    await expect(historyRow).toBeVisible();
    await historyRow.click();

    // Routes back to the same editor, pre-filled with what was just saved —
    // a pick reached from history is not a different kind of object, only a
    // different way of finding one.
    await expect(page).toHaveURL(/\/grower\/picks\?pickId=/);
    await expect(palletsInput).toHaveValue("12.5");
    await expect(pickupInput).toHaveValue("09:15");
    await expect(commentInput).toHaveValue("gate code 4321");
  });

  test("Cancel discards an in-progress edit without touching the server — a reload shows the original values", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    await openTodayFor(grower.companyId);

    const growerUser = await createTestProfile({ companyId: grower.companyId, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerUser.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(growerUser.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(growerUser.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/grower\/picks$/);

    // Establish a real, saved baseline first, so "the original values"
    // means something other than the bootstrap default. No "ערוך" gate to
    // open first — see the previous test.
    const palletsInput = page.locator('input[type="number"]');
    const commentInput = page.locator('input[type="text"]');
    await palletsInput.fill("3");
    await commentInput.fill("baseline comment");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("השורות נשמרו.")).toBeVisible();

    // Change values again, but hit Cancel instead of Save.
    await palletsInput.fill("999");
    await commentInput.fill("this should never be saved");
    await page.getByRole("button", { name: "בטל שינויים" }).click();

    // Cancel already restores the visible draft locally...
    await expect(palletsInput).toHaveValue("3");
    await expect(commentInput).toHaveValue("baseline comment");

    // ...but the real assertion is server state: a fresh reload re-fetches
    // from scratch, with no client-side draft state left to fall back on.
    await page.reload();
    await expect(palletsInput).toHaveValue("3");
    await expect(commentInput).toHaveValue("baseline comment");
  });
});
