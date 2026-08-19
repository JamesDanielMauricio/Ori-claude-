import { createTestCompany, createTestProfile, deleteTestCompany, deleteTestUser, runCleanup } from "@ori/domain/auth/testing";
import { expect, test } from "@playwright/test";

// Self-service Edit Profile (PRD: user-profile.md, edit-profile.md). Not
// role-scoped — any authenticated user can reach /profile — so this uses
// a customer identity, but nothing here is customer-specific.
test.describe("Profile — self-service edit", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("a user edits their display name and phone, and both persist across a reload", async ({ page }) => {
    const company = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(company.id));
    const user = await createTestProfile({ companyId: company.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(user.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(user.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);

    await page.goto("/profile");
    const nameInput = page.getByLabel("שם תצוגה");
    const phoneInput = page.getByLabel("טלפון");
    await expect(nameInput).toBeVisible();

    await nameInput.fill("Edited Display Name");
    await phoneInput.fill("0521234567");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("הפרופיל נשמר.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("שם תצוגה")).toHaveValue("Edited Display Name");
    await expect(page.getByLabel("טלפון")).toHaveValue("0521234567");
  });

  test("editing then cancelling discards the change — the original value survives a reload", async ({ page }) => {
    const company = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(company.id));
    const user = await createTestProfile({ companyId: company.id, role: "customer", displayName: "Original Name" });
    cleanupFns.push(() => deleteTestUser(user.userId));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(user.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);

    await page.goto("/profile");
    const nameInput = page.getByLabel("שם תצוגה");
    await expect(nameInput).toHaveValue("Original Name");
    await nameInput.fill("Should Not Persist");
    await page.getByRole("button", { name: "ביטול" }).click();
    await expect(nameInput).toHaveValue("Original Name");

    await page.reload();
    await expect(page.getByLabel("שם תצוגה")).toHaveValue("Original Name");
  });
});
