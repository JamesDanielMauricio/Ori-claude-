import { db } from "@ori/db";
import { alertTypes, alerts } from "@ori/db/schema";
import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "@ori/domain/auth/testing";
import { deleteTestAlert, deleteTestAlertType } from "@ori/domain/notifications/testing";
import { expect, test } from "@playwright/test";

// Drives the in-app alert bell end to end: an unread badge appears, the
// dropdown lists the alert, clicking it marks the alert read (verified by
// re-querying the alerts list after the RLS-scoped update round-trips —
// the badge only clears once the refetch sees read: true server-side, not
// from local optimistic state) and navigates to the alert type's own deep
// link — no backoffice UI exists
// yet to trigger a real close_arrangement alert, so the alert row itself
// is seeded directly (same convention as customer-order.spec.ts's grower
// product line, a deliberate exception to the "e2e specs only use
// @ori/domain/*/testing" rule since nothing else creates this specific
// shape yet).
test.describe("Alerts — in-app bell", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  test("shows an unread badge, marks an alert read and navigates to its deep link on click", async ({ page }) => {
    const customerCompany = await createTestCompany(`Test Customer ${crypto.randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    const customerUser = await createTestProfile({ companyId: customerCompany.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customerUser.userId));

    const [alertType] = await db
      .insert(alertTypes)
      .values({
        mainText: `Test Alert ${crypto.randomUUID()}`,
        appScreen: "/customer/history",
      })
      .returning();
    if (!alertType) throw new Error("failed to create test alert type");
    cleanupFns.push(() => deleteTestAlertType(alertType.id));

    const [alertRow] = await db
      .insert(alerts)
      .values({
        intendedForUserId: customerUser.userId,
        alertTypeId: alertType.id,
        sendAsWhatsapp: false,
        sendAsNotification: true,
      })
      .returning();
    if (!alertRow) throw new Error("failed to create test alert");
    cleanupFns.push(() => deleteTestAlert(alertRow.id));

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(customerUser.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(customerUser.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);

    const bell = page.getByRole("button", { name: "התראות" });
    await expect(bell.getByText("1")).toBeVisible();

    await bell.click();
    // getByText would match both the button and its inner span (the
    // button has no other text), so target the button by role instead.
    const alertButton = page.getByRole("button", { name: alertType.mainText });
    await expect(alertButton).toBeVisible();
    await alertButton.click();

    await expect(page).toHaveURL(/\/customer\/history$/);
    await expect(bell.getByText("1")).toHaveCount(0);
  });
});
