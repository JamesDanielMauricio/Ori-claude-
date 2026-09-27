import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import {
  initiateBusinessDayInputSchema,
  toInitiateBusinessDayRpcArgs,
} from "@ori/domain/lifecycle-engine";
import {
  createTestGrowerWithProduct,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
} from "@ori/domain/lifecycle-engine/testing";
import { expect, test } from "@playwright/test";

// Drives the distributor's Grower Inventory Status oversight screen end to
// end: a flat, always-visible list of every active grower (the reference
// design's two-column layout — see distributor-grower.tsx's own comment for
// why this replaced a master-detail pane), a chevron per row revealing that
// grower's pick grouped by family, and a pencil opening the exact same
// PickLinesEditor the grower's own screen uses, in a dialog. As with
// grower-picks.spec.ts, the trading day is opened headlessly via the real
// initiate_business_day RPC since there is no backoffice UI for that yet.
test.describe("Backoffice — Grower Inventory Status", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("a distributor expands a grower's row, edits a pick line via the pencil dialog, and the change persists across a reload", async ({
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
    const { data, error } = await adminClient.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs(input),
    );
    if (error) throw error;
    const dayId = data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    await page.goto("/backoffice/distributor-grower");

    // Expanding shows the pick's one product, grouped under its family —
    // the read-only browse view, distinct from editing.
    // `exact`, not a regex + `.first()`: the row's pencil and bell are
    // labelled "ערוך את מלאי <name>" and "שלח תזכורת ל<name>", so a substring
    // match catches all three — and the pencil comes FIRST in the DOM, so
    // `.first()` was opening the edit dialog here instead of expanding the
    // row, leaving that dialog to swallow the deliberate pencil click below.
    const expandButton = page.getByRole("button", { name: growerName, exact: true });
    await expandButton.click();
    await expect(page.getByRole("button", { name: `ערוך את מלאי ${growerName}` })).toBeVisible();

    // The pencil, not the row itself, is what opens the editor now.
    await page.getByRole("button", { name: `ערוך את מלאי ${growerName}` }).click();
    await expect(page.locator("dialog[open]")).toContainText(`מלאי — ${growerName}`);

    // No "ערוך" gate inside the popup: clicking the pencil already was the
    // decision to edit, so the fields are live and "שמור" is on screen
    // immediately, same as the arrangement board's identical dialog.
    await expect(page.getByRole("button", { name: "ערוך", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שמור" })).toBeVisible();

    // Families are collapsed by default (pick-lines-editor.tsx) — expand the
    // fixture's one family before its inputs are interactable (`inert`
    // while collapsed).
    await page.locator("dialog[open]").getByRole("button", { expanded: false }).click();

    // Scoped by aria-label, not `input[type="number"]` — the row now also
    // carries a leftover-pallets input of the same type (pick-lines-editor.tsx).
    const palletsInput = page.locator("dialog[open]").getByLabel("פלטות שנקטפו");
    await expect(palletsInput).toBeEnabled();
    const commentInput = page.locator('dialog[open] input[type="text"]');
    const editorDialog = page.getByRole("dialog", { name: `מלאי — ${growerName}` });
    await palletsInput.fill("8");
    await editorDialog.getByLabel("פלטות עודף").fill("2");
    await commentInput.fill("distributor-entered note");
    // `exact` throughout: the review popup's own button is also "שמור".
    await editorDialog.getByRole("button", { name: "שמור", exact: true }).click();

    // Save opens the same review popup the grower gets, on top of this one,
    // with each product's picked, leftover and total (picked + leftover).
    const confirmDialog = page.getByRole("dialog", { name: "אישור ליקוט" });
    await expect(confirmDialog).toContainText("נקטף 8");
    await expect(confirmDialog).toContainText("עודף 2");
    await expect(confirmDialog).toContainText("סה״כ 10");
    // A distributor's save doesn't send the pick, so the button doesn't claim to.
    await expect(confirmDialog.getByRole("button", { name: "שמור ושלח" })).toHaveCount(0);

    // Backing out closes ONLY the review: the editor underneath stays open
    // with the edit still in it. It used to close both — the review's close
    // event reached this dialog's handler too (see ui/dialog.tsx) — so keep
    // working in the editor afterwards: every step below needs it alive.
    await confirmDialog.getByRole("button", { name: "חזרה לעריכה" }).click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(editorDialog).toBeVisible();
    await expect(palletsInput).toHaveValue("8");
    await palletsInput.fill("9");
    await editorDialog.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(confirmDialog).toContainText("סה״כ 11");

    await confirmDialog.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(page.getByText("השורות נשמרו.")).toBeVisible();
    // No explicit close here: a successful save closes this dialog itself
    // (distributor-grower.tsx's onSaved clears pickDialogGrower), so waiting
    // to click "סגור" waits for a button that is already gone.
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    // Saved, not sent: the pick is still the grower's draft. Sending from the
    // distributor's side stays the arrangement board's truck icon.
    expect((await getDailyPickForGrower(dayId, grower.companyId))?.status).toBe("draft");

    await page.reload();
    await page.getByRole("button", { name: `ערוך את מלאי ${growerName}` }).click();
    await page.locator("dialog[open]").getByRole("button", { expanded: false }).click();
    await expect(page.locator("dialog[open]").getByLabel("פלטות שנקטפו")).toHaveValue("9");
    await expect(page.locator("dialog[open]").getByLabel("פלטות עודף")).toHaveValue("2");
    await expect(page.locator('dialog[open] input[type="text"]')).toHaveValue(
      "distributor-entered note",
    );
  });
});
