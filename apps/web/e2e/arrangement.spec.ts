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
  openShopInputSchema,
  toInitiateBusinessDayRpcArgs,
  toOpenShopRpcArgs,
  toUpdatePickProductPalletsRpcArgs,
  updatePickProductPalletsInputSchema,
} from "@ori/domain/lifecycle-engine";
import {
  createTestGrowerWithProduct,
  createTestOrderProductLine,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
  getPickProductLine,
} from "@ori/domain/lifecycle-engine/testing";
import { expect, type Page, test } from "@playwright/test";

// Drives the distributor's allocation workspace end to end.
//
// The board's method is one grower's pick line at a time: select a product
// inside a grower's card, and the customer list splits at a dashed rule into
// the people who ordered it and the people who did not. This walks that —
// the four day figures, the ✓/✎ quantity control on a customer who ordered,
// the + that pushes surplus to one who did not, and Close Arrangement as the
// terminal action — plus the sibling screen that presents the same day as a
// product × customer grid (/backoffice/new-arrangement), since a cell typed
// there has to land on this board.
//
// Same headless-RPC-bootstrap convention as
// customer-order.spec.ts/distributor-grower.spec.ts (no backoffice UI exists
// yet for opening/closing the shop itself).
//
// REQUIRES migration 0040 (arrange_to_customer). The ✓ button is that
// function; without it the board reports "פעולה זו דורשת מיגרציה שטרם הורצה".
test.describe("Backoffice — arrangement workspace", () => {
  const cleanupFns: Array<() => Promise<void>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  // Page state resets on every navigation, and the board deliberately starts
  // with nothing selected — so anything that leaves and comes back has to
  // choose the grower's product again before the figures mean anything.
  //
  // Expands THIS test's grower card and selects its single product line.
  //
  // `growerName` is required rather than defaulting to the first card on the
  // board: initiate_business_day bootstraps a pick for every eligible grower,
  // so the column also lists every seeded demo grower. Taking `.first()`
  // there selected somebody else's card, and the strip then reported their
  // figures (0 picked) against this test's expectations (10).
  async function selectGrowerProduct(page: Page, growerName: string) {
    const growersColumn = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "מגדלים" }) });
    const growerCard = growersColumn.locator("li").filter({ hasText: growerName });
    await growerCard.locator("button[aria-expanded]").first().click();
    await growerCard.locator("button[aria-pressed]").first().click();
  }

  // Longer than the 30s default: this walks the board, the matrix, the
  // records table, both pencils and the close, and deliberately sits out one
  // toast's full lifetime (see the "+ pushes surplus" section). Against the
  // hosted project from a developer machine every round trip is a real
  // network hop, which left the run already close to 30s before that wait
  // was added. The extra budget is for those round trips, not for hiding a
  // hang; each individual assertion keeps its own (much shorter) timeout.
  test("selects a grower's product, allocates to an ordering and a non-ordering customer, and closes the arrangement", async ({
    page,
  }) => {
    test.slow();
    const adminCompany = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(adminCompany.id));
    const admin = await createTestProfile({ companyId: adminCompany.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));
    const adminClient = await signInTestUser(admin.email, admin.password);

    // Priced, unlike every other spec's fixture: this test closes the day at
    // the end, and close_arrangement refuses to close one holding a record it
    // cannot price. The ✓ that pushes surplus to a non-ordering customer
    // writes a quantity and no price, so without a catalog price to fall back
    // on that record makes the close fail (P0007). Deliberately NOT the 12.5
    // typed into the records table below, so the assertion that the typed
    // price survives a quantity-only press still proves something.
    const grower = await createTestGrowerWithProduct({ price: 9.9 });
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    // The board addresses growers by name — see selectGrowerProduct.
    const growerName = grower.companyName;
    const customerCompany = await createTestCompany("לקוח בדיקה", "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));
    // Created BEFORE open_shop, which is what bootstraps a daily_orders
    // header per active customer. This one never orders anything: they are
    // the board's lower section, and the target of the + button.
    const surplusCompany = await createTestCompany("Surplus Customer", "customer");
    cleanupFns.push(() => deleteTestCompany(surplusCompany.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await adminClient.rpc(
      "initiate_business_day",
      toInitiateBusinessDayRpcArgs(initiateBusinessDayInputSchema.parse({ tradeDate })),
    );
    if (initiate.error) throw initiate.error;
    const dayId = initiate.data!.id;
    cleanupFns.push(() => deleteTestTradingDay(dayId));

    const openShop = await adminClient.rpc(
      "open_shop",
      toOpenShopRpcArgs(openShopInputSchema.parse({ canSeePrices: true })),
    );
    if (openShop.error) throw openShop.error;

    const pick = await getDailyPickForGrower(dayId, grower.companyId);
    const pickLine = await getPickProductLine(pick!.id, grower.varietyId);
    const pickUpdate = await adminClient.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs(
        updatePickProductPalletsInputSchema.parse({
          dailyPickProductId: pickLine!.id,
          palletsPicked: 10,
        }),
      ),
    );
    if (pickUpdate.error) throw pickUpdate.error;

    // open_shop already bootstrapped this customer's daily_orders header —
    // createTestOrderProductLine only adds the line.
    await createTestOrderProductLine(dayId, customerCompany.id, grower.varietyId, 6);

    await page.goto("/login");
    await page.getByLabel("אימייל").fill(admin.email);
    await page.getByLabel("סיסמה", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();
    await expect(page).toHaveURL(/\/backoffice\/shop$/);

    // --- Nothing is selected until a grower's product is clicked ---
    await page.goto("/backoffice/arrangement");
    await expect(page.getByText("בחר מוצר מכרטיס של מגדל כדי לסדר אותו ללקוחות.")).toBeVisible();

    await selectGrowerProduct(page, growerName);

    // Each figure is a named `role="group"` wrapping its own label and
    // numeral, which is what makes them addressable at all — the numbers
    // themselves ("10", "6") are far too common on this screen to assert on
    // by text.
    await expect(page.getByRole("group", { name: "נקטף" })).toContainText("10");
    await expect(page.getByRole("group", { name: "הוזמן" })).toContainText("6");
    await expect(page.getByRole("group", { name: "חולק" })).toContainText("0");
    await expect(page.getByRole("group", { name: "נותר" })).toContainText("10");

    // The dashed rule, with the customer who ordered above it and the one
    // who did not below.
    await expect(page.getByText("לא הזמינו את המוצר הנבחר")).toBeVisible();

    // --- The arrangement matrix (סידור לפי מוצרים) ---
    // Products down the side, customers across the top, reached from
    // BackofficeNav's own item like any other backoffice route. Each cell is
    // one grower's lot going to one customer, so a cell is addressable by
    // "<product> — <customer>" — both halves, not just the customer: the grid
    // carries a cell per product row, so anchoring on the customer alone
    // matches every seeded product's cell in that column too.
    await page.goto("/backoffice/new-arrangement");

    // Filter down to this fixture's product first. The grid is virtualised —
    // only the rows in the scroll window exist in the DOM (see
    // arrangement-matrix.tsx's `visibleRows`) — so against a seeded catalog
    // of hundreds of varieties this row is simply not rendered until the
    // search narrows the list to it.
    await page.getByPlaceholder("חיפוש מוצר…").fill(grower.varietyName);

    // Scoped to this fixture's own product row. The board lists every
    // variety with supply on the day, so "is there any expand control on the
    // page" would otherwise be answered by somebody else's multi-grower row.
    const productRow = page.locator("tr").filter({ hasText: grower.varietyName });
    await expect(productRow.getByRole("button", { name: /^פתח מגדלים/ })).toHaveCount(0);

    const matrixCell = page.getByLabel(`${grower.varietyName} — ${customerCompany.name}`, {
      exact: true,
    });
    await expect(matrixCell).toHaveValue("");
    await matrixCell.fill("5");
    // Enter commits the cell, the same as it would in a spreadsheet. There is
    // deliberately no success toast — a distributor types across a whole row
    // — so the confirmation is the value coming back from the server.
    await matrixCell.press("Enter");
    await expect(matrixCell).toHaveValue("5");

    // A refused quantity must not be left sitting in the cell. Only 10 were
    // picked, so 99 over-allocates and arrange_to_customer raises P0009; the
    // grid has to fall back to the stored value rather than keep a number the
    // day does not actually contain.
    await matrixCell.fill("99");
    await matrixCell.press("Enter");
    await expect(page.getByText(/חורגת ממה שנקטף/)).toBeVisible();
    await expect(matrixCell).toHaveValue("5");

    // --- Back on the board: the matrix's record shows against the day ---
    await page.goto("/backoffice/arrangement");
    await selectGrowerProduct(page, growerName);
    await expect(page.getByRole("group", { name: "חולק" })).toContainText("5");
    await expect(page.getByRole("group", { name: "נותר" })).toContainText("5");

    // The records table is collapsed by default now that the board above is
    // the working surface — it has to be opened before it can be read.
    await page.getByRole("button", { name: /רשומות סידור/ }).click();
    await expect(page.getByLabel("כמות משטחים", { exact: true })).toHaveValue("5");

    // The matrix writes quantities and nothing else — pricing is
    // close_arrangement's job, or a deliberate edit here. Setting one now is
    // what gives the COALESCE assertion further down something to survive.
    // `exact` because the sidebar's always-present Business Day Panel carries
    // a "לקוחות מורשים רואים מחירים" checkbox, and getByLabel matches on
    // substring — same collision reference-data-products.spec.ts handles.
    //
    // Scoped to the records table on top of that: PriceEditDialog stays
    // mounted while closed, and its own field is labelled exactly "מחיר" too,
    // so even the exact match resolves to two inputs. getByLabel does not
    // filter by visibility, so being closed does not take it out of the
    // running.
    const recordPrice = page.locator("table").getByLabel("מחיר", { exact: true });
    await expect(recordPrice).toHaveValue("");
    await recordPrice.fill("12.5");
    await page.getByRole("button", { name: "שמור", exact: true }).click();
    await expect(page.getByText("השיוך עודכן.")).toBeVisible();
    await expect(recordPrice).toHaveValue("12.5");

    // Toggling the view mode re-sorts the same underlying records table —
    // it must still show the one record, not clear it.
    await page.getByRole("button", { name: "לפי מגדל" }).click();
    await expect(page.getByLabel("כמות משטחים", { exact: true })).toHaveValue("5");

    // --- ✓ / ✎ on a customer who ordered the selected product ---
    // A row with a record already written starts idle: pencil showing, box
    // locked. Pressing the pencil is what opens it for editing.
    const arrangeInput = page.getByLabel("כמות לסידור עבור לקוח בדיקה");
    await expect(arrangeInput).toHaveValue("5");
    await expect(arrangeInput).toBeDisabled();
    await page.getByRole("button", { name: "ערוך סידור עבור לקוח בדיקה" }).click();
    await expect(arrangeInput).toBeEnabled();

    await arrangeInput.fill("4");
    await page.getByRole("button", { name: "שמור סידור עבור לקוח בדיקה" }).click();
    await expect(page.getByText("הסידור נשמר.")).toBeVisible();
    await expect(page.getByRole("group", { name: "חולק" })).toContainText("4");
    // Saved rows go back to idle.
    await expect(page.getByRole("button", { name: "ערוך סידור עבור לקוח בדיקה" })).toBeVisible();

    // The price must survive a quantity-only press. arrange_to_customer
    // COALESCEs price onto the existing record rather than assigning it, so
    // the 12.5 set in the records table above is still there — a plain
    // assignment would have blanked it and nothing on the board would have
    // shown that it had.
    await expect(page.getByLabel("כמות משטחים", { exact: true })).toHaveValue("4");
    await expect(recordPrice).toHaveValue("12.5");

    // A refused quantity must not be left sitting in the box. לקוח בדיקה
    // ordered 6, so 99 over-allocates and the RPC raises P0009; the row has
    // to put the stored value back, because a rejected write leaves that
    // value unchanged and so the re-seed-on-server-change guard never fires.
    await page.getByRole("button", { name: "ערוך סידור עבור לקוח בדיקה" }).click();
    await arrangeInput.fill("99");
    await arrangeInput.press("Enter");
    await expect(page.getByText(/חורגת ממה שנקטף/)).toBeVisible();
    await expect(arrangeInput).toHaveValue("4");
    await expect(page.getByRole("group", { name: "חולק" })).toContainText("4");

    // --- + pushes surplus to a customer who never ordered it ---
    // The + writes nothing on its own: it moves the card above the rule and
    // offers a box. The order line only comes into existence on ✓, at zero
    // pallets, which is what makes the row below read "ordered 0, got 2".
    //
    // The ✓ save above raised this section's "הסידור נשמר." toast well under
    // its 4s lifetime ago (toast.tsx's TOAST_DURATION_MS), so it is still on
    // screen. Waiting for it to clear first is what makes the toast assertion
    // below prove THIS save: without it, the stale toast satisfied it before
    // this save's response arrived — and when the response was fast enough
    // that both were up at once, CI failed on a strict-mode "resolved to 2
    // elements" instead.
    await expect(page.getByText("הסידור נשמר.")).toHaveCount(0);
    const surplusCard = page.getByRole("article", { name: "Surplus Customer" });
    await surplusCard.getByRole("button", { name: /הצע את המוצר הנבחר/ }).click();

    const surplusInput = page.getByLabel("כמות לסידור עבור Surplus Customer");
    await expect(surplusInput).toBeVisible();
    await surplusInput.fill("2");
    await surplusInput.press("Enter");
    await expect(page.getByText("הסידור נשמר.")).toBeVisible();

    await expect(page.getByRole("group", { name: "חולק" })).toContainText("6");
    await expect(page.getByRole("group", { name: "נותר" })).toContainText("4");
    await expect(
      page.getByRole("article", { name: "Surplus Customer" }).getByTitle("הוזמן 0, חולק 2"),
    ).toBeVisible();

    // --- Both pencils open popups, neither navigates ---
    // The board is a working position — a selected pick line, a promoted
    // customer, a scroll offset — and correcting a grower's pallet count or a
    // customer's order must not cost the distributor that position.
    await page
      .getByRole("button", { name: /^ערוך את מלאי/ })
      .first()
      .click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await expect(page.locator("dialog[open]")).toContainText("מלאי —");
    await expect(page).toHaveURL(/\/backoffice\/arrangement$/);
    // Clicking the pencil WAS the decision to edit, so the popup does not
    // ask a second time: the fields are live and "שמור" is already on
    // screen rather than under the whole line list.
    const growerDialog = page.locator("dialog[open]");
    await expect(growerDialog.getByRole("button", { name: "ערוך", exact: true })).toHaveCount(0);
    await expect(growerDialog.locator('input[type="number"]').first()).toBeEnabled();
    await expect(growerDialog.getByRole("button", { name: "שמור" })).toBeVisible();
    await page.locator("dialog[open]").getByRole("button", { name: "סגור" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    await page.getByRole("button", { name: "ערוך את הזמנת לקוח בדיקה" }).click();
    await expect(page.locator("dialog[open]")).toContainText("הזמנה — לקוח בדיקה");
    await expect(page).toHaveURL(/\/backoffice\/arrangement$/);
    const orderDialog = page.locator("dialog[open]");
    await expect(orderDialog.getByRole("button", { name: "ערוך", exact: true })).toHaveCount(0);
    await expect(orderDialog.getByRole("button", { name: "שמור" })).toBeVisible();
    await page.locator("dialog[open]").getByRole("button", { name: "סגור" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // The selection survived both popups, so the board is still usable.
    await expect(page.getByRole("group", { name: "חולק" })).toContainText("6");

    // --- Close Business Day: blocked until the shop is closed ---
    // This screen carries no close-arrangement control of its own any more
    // — the sidebar's BusinessDayPanel, mounted on every backoffice screen
    // including this one, is the one write surface for it. "סגירת יום
    // עסקים" here calls the exact same close_arrangement RPC the removed
    // page-level button used to.
    const closeDayButton = page.getByRole("button", { name: "סגירת יום עסקים" });
    await expect(closeDayButton).toBeDisabled();

    const closeShop = await adminClient.rpc("close_shop");
    if (closeShop.error) throw closeShop.error;

    await page.reload();
    await expect(closeDayButton).toBeEnabled();
    await closeDayButton.click();
    await page.getByRole("button", { name: "סגור יום עסקים" }).click();
    await expect(page.getByText("יום העסקים נסגר.")).toBeVisible();

    // Once the day reaches phase "closed", it drops out of the workspace's
    // "currently active day" query — same convention as
    // distributor-grower's own open-day query (`neq("phase", "closed")`).
    // The empty state is itself proof the close committed, on top of the
    // success toast above.
    await expect(page.getByRole("heading", { name: "אין יום מסחר פתוח" })).toBeVisible();
  });
});
