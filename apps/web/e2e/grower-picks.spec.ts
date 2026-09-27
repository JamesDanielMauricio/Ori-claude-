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

  async function openTodayFor(growerCompanyId: string): Promise<{ dayId: string; pickId: string }> {
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
    return { dayId, pickId: pick.id };
  }

  test("a grower edits a pick line's pallets and comment, confirms it in the review popup, and it is saved AND sent", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { dayId } = await openTodayFor(grower.companyId);

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

    // Families are collapsed by default (pick-lines-editor.tsx) — expand the
    // fixture's one family before its inputs are interactable (`inert`
    // while collapsed).
    await page.locator("main").getByRole("button", { expanded: false }).click();

    // Scoped by aria-label, not `input[type="number"]` — the row now also
    // carries a leftover-pallets input of the same type (pick-lines-editor.tsx).
    const palletsInput = page.getByLabel("פלטות שנקטפו");
    const commentInput = page.locator('input[type="text"]');

    // "שמור" is the only button — the separate "שלח ליקוט" is gone, because
    // saving now also sends (pick-lines-editor.tsx's `submitOnSave`).
    await expect(page.getByRole("button", { name: "שלח ליקוט" })).toHaveCount(0);

    await palletsInput.fill("12");
    await page.getByLabel("פלטות עודף").fill("3");
    await commentInput.fill("gate code 4321");
    // `exact` throughout: the popup's own confirm button is "שמור ושלח",
    // which a substring match on "שמור" would also hit.
    await page.getByRole("button", { name: "שמור", exact: true }).click();

    // The review popup lists what is about to be sent, grouped under its
    // family — and every family is already open: nothing in it expands or
    // collapses, so the line is readable without clicking anything.
    const confirmDialog = page.locator("dialog[open]");
    await expect(confirmDialog).toContainText("אישור ליקוט");
    await expect(confirmDialog.getByRole("heading", { name: grower.familyName })).toBeVisible();
    await expect(confirmDialog.locator("[aria-expanded]")).toHaveCount(0);
    await expect(confirmDialog.getByText(grower.varietyName)).toBeVisible();
    await expect(confirmDialog).toContainText("נקטף 12");
    await expect(confirmDialog).toContainText("עודף 3");
    // The product's total: picked + leftover.
    await expect(confirmDialog).toContainText("סה״כ 15");
    await expect(confirmDialog).toContainText("gate code 4321");

    // Backing out sends nothing: the popup closes and the pick is still a draft.
    await confirmDialog.getByRole("button", { name: "חזרה לעריכה" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.locator("main").getByText("טיוטה", { exact: true })).toBeVisible();
    expect((await getDailyPickForGrower(dayId, grower.companyId))?.status).toBe("draft");

    // Confirming saves and sends in one go.
    await page.getByRole("button", { name: "שמור", exact: true }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "שמור ושלח" }).click();
    await expect(page.getByText("הליקוט נשמר ונשלח.")).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.locator("main").getByText("נשלח", { exact: true })).toBeVisible();
    expect((await getDailyPickForGrower(dayId, grower.companyId))?.status).toBe("submitted");
    // Sent, and nothing edited since: nothing left for "שמור" to do.
    await expect(page.getByRole("button", { name: "שמור", exact: true })).toBeDisabled();

    await page.reload();
    // A fresh mount re-collapses every family.
    await page.locator("main").getByRole("button", { expanded: false }).click();
    // <input type="number"> normalizes its DOM value (strips insignificant
    // trailing zeros) regardless of the exact string the numeric(10,2)
    // column round-trips as — "12" here, not "12.00".
    await expect(palletsInput).toHaveValue("12");
    await expect(commentInput).toHaveValue("gate code 4321");

    // The pick history list (routes/grower/history.tsx), the grower-module
    // counterpart of the customer's order history. Saving sent this pick, so
    // it shows "נשלח" — same badge picks.tsx itself shows.
    await page.goto("/grower/history");
    const historyRow = page.getByRole("button", { name: "נשלח" });
    await expect(historyRow).toBeVisible();
    await historyRow.click();

    // Routes back to the same editor, pre-filled with what was just saved —
    // a pick reached from history is not a different kind of object, only a
    // different way of finding one.
    await expect(page).toHaveURL(/\/grower\/picks\?pickId=/);
    // A route change remounts the editor, re-collapsing every family.
    await page.locator("main").getByRole("button", { expanded: false }).click();
    await expect(palletsInput).toHaveValue("12");
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
    //
    // Families are collapsed by default — expand the fixture's one family
    // before its inputs are interactable.
    await page.locator("main").getByRole("button", { expanded: false }).click();
    const palletsInput = page.getByLabel("פלטות שנקטפו");
    const commentInput = page.locator('input[type="text"]');
    await palletsInput.fill("3");
    await commentInput.fill("baseline comment");
    await page.getByRole("button", { name: "שמור", exact: true }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "שמור ושלח" }).click();
    await expect(page.getByText("הליקוט נשמר ונשלח.")).toBeVisible();
    // A modal <dialog> makes the rest of the page inert until it has finished
    // closing, so wait it out before typing into the editor again.
    await expect(page.locator("dialog[open]")).toHaveCount(0);

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
    await page.locator("main").getByRole("button", { expanded: false }).click();
    await expect(palletsInput).toHaveValue("3");
    await expect(commentInput).toHaveValue("baseline comment");
  });

  test("a draft pick can be sent with nothing edited — Save stays live, the popup says it's empty, and confirming submits it", async ({
    page,
  }) => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const { dayId } = await openTodayFor(grower.companyId);

    const growerUser = await createTestProfile({ companyId: grower.companyId, role: "grower" });
    cleanupFns.push(() => deleteTestUser(growerUser.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(growerUser.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(growerUser.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/grower\/picks$/);

    // Freshly bootstrapped, nothing typed. With "שמור" as the only way to
    // send, it must not be greyed out just because nothing changed — the
    // pick is still an unsent draft. "בטל שינויים" still is: nothing to undo.
    const saveButton = page.getByRole("button", { name: "שמור", exact: true });
    await expect(saveButton).toBeEnabled();
    await expect(page.getByRole("button", { name: "בטל שינויים" })).toBeDisabled();

    await saveButton.click();
    const confirmDialog = page.locator("dialog[open]");
    await expect(confirmDialog).toContainText("לא הוזנו כמויות");
    await confirmDialog.getByRole("button", { name: "שמור ושלח" }).click();

    await expect(page.getByText("הליקוט נשמר ונשלח.")).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.locator("main").getByText("נשלח", { exact: true })).toBeVisible();
    expect((await getDailyPickForGrower(dayId, grower.companyId))?.status).toBe("submitted");
    await expect(saveButton).toBeDisabled();
  });
});
