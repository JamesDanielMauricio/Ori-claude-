import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "@ori/domain/auth/testing";
import { expect, test, type Page } from "@playwright/test";

// One tab, one account signs out, another signs in. The app keeps what it has
// read in one cache per tab, and most of its keys don't name the account, so
// the second person used to be shown the first one's cached profile, order and
// alerts — and could save them as their own. Each account now gets a cache of
// its own (lib/account-scope.ts, lib/providers.tsx). Every step here moves
// inside the app — sign-out, sign-in, the "חזרה" link, the browser's Back —
// because a full page load would start a new cache anyway and hide the bug.
test.describe("Account switch — one tab, two accounts", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  async function account(role: "customer" | "grower", displayName: string) {
    const company = await createTestCompany(`חברת בדיקה ${crypto.randomUUID()}`, role);
    cleanupFns.push(() => deleteTestCompany(company.id));
    const user = await createTestProfile({ companyId: company.id, role, displayName });
    cleanupFns.push(() => deleteTestUser(user.userId));
    return user;
  }

  async function signIn(page: Page, user: { email: string; password: string }, home: RegExp) {
    await page.getByLabel("אימייל").fill(user.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(home);
  }

  async function signOut(page: Page) {
    await page.getByRole("button", { name: "התנתקות" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  }

  // Walks back through the tab's history to the profile screen.
  async function backToProfile(page: Page) {
    for (let step = 0; step < 6 && !page.url().endsWith("/profile"); step++) {
      await page.goBack();
    }
    await expect(page).toHaveURL(/\/profile$/);
  }

  // Which account a request was made for: the `sub` of its bearer token.
  function requestedFor(authorization: string | undefined): string | null {
    const payload = authorization?.replace(/^Bearer /, "").split(".")[1];
    if (!payload) return null;
    try {
      return (
        (JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub?: string }).sub ?? null
      );
    } catch {
      return null;
    }
  }

  test("A → profile → Back → sign-out → B → browser Back: B sees their own profile, never A's", async ({
    page,
  }) => {
    const a = await account("customer", "First Account");
    const b = await account("customer", "Second Account");

    await page.goto("/login");
    await signIn(page, a, /\/customer\/order$/);
    await page.goto("/profile");
    await expect(page.getByLabel("שם תצוגה")).toHaveValue("First Account");
    await page.getByRole("link", { name: "חזרה" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);
    await signOut(page);

    await signIn(page, b, /\/customer\/order$/);
    await backToProfile(page);
    await expect(page.getByLabel("שם תצוגה")).toHaveValue("Second Account");
    await expect(page.getByLabel("שם תצוגה")).not.toHaveValue("First Account");

    // And saving there writes B's own values to B's own row.
    await page.getByLabel("טלפון").fill("0529876543");
    await page.getByRole("button", { name: "שמור" }).click();
    await expect(page.getByText("הפרופיל נשמר.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("שם תצוגה")).toHaveValue("Second Account");
  });

  test("a reply that arrives late for the previous account never reaches the next one — across a role and company change", async ({
    page,
  }) => {
    const a = await account("customer", "Late Customer");
    const b = await account("grower", "Next Grower");

    // A's profile read is held back until B has signed in. Only the profile
    // screen's own read (the one that asks for the phone number) is held, and
    // only when it is made for A.
    const held: Array<() => Promise<void>> = [];
    await page.route("**/rest/v1/profiles*", async (route) => {
      const request = route.request();
      if (
        request.url().includes("phone_number") &&
        requestedFor(request.headers().authorization) === a.userId
      ) {
        held.push(() => route.continue());
      } else {
        await route.continue();
      }
    });

    await page.goto("/login");
    await signIn(page, a, /\/customer\/order$/);
    await page.goto("/profile");
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await page.getByRole("link", { name: "חזרה" }).click();
    await expect(page).toHaveURL(/\/customer\/order$/);
    await signOut(page);

    await signIn(page, b, /\/grower\//);
    await backToProfile(page);
    await expect(page.getByLabel("שם תצוגה")).toHaveValue("Next Grower");

    // A's answer finally arrives. It must not replace what B sees.
    for (const release of held) await release();
    await page.waitForTimeout(1000);
    await expect(page.getByLabel("שם תצוגה")).toHaveValue("Next Grower");
  });
});
