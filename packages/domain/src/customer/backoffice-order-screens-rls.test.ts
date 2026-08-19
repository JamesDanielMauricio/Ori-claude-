import { randomUUID } from "node:crypto";

import { db } from "@ori/db";
import { dailyOrders } from "@ori/db/schema";
import type { Database } from "@ori/db/supabase-types";
import { toCreateArrangementRecordRpcArgs } from "@ori/domain/arrangement";
import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
  signInTestUser,
} from "@ori/domain/auth/testing";
import { toInitiateBusinessDayRpcArgs, toUpdatePickProductPalletsRpcArgs } from "@ori/domain/lifecycle-engine";
import {
  createTestGrowerWithProduct,
  createTestOrderProductLine,
  deleteTestGrowerWithProduct,
  deleteTestTradingDay,
  getDailyPickForGrower,
  getPickProductLine,
} from "@ori/domain/lifecycle-engine/testing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// RLS coverage specifically for the two backoffice-only screens this
// prompt adds — /backoffice/distributor-customer (Customer Order Status)
// and /backoffice/order-history (Arrangement + Orders History by Date).
// Neither screen adds any new RLS policy of its own (daily_orders_select_
// backoffice, daily_order_products_select_backoffice, and arrangement_
// records_select_backoffice already existed — see 0010/0017); this file
// is the explicit proof that a non-backoffice role really can't reach
// what those screens read, same discipline as reference-data/rls.test.ts
// and auth/rls.test.ts for their own modules.
describe("backoffice order/arrangement screens Row Level Security", () => {
  const cleanupFns: Array<() => Promise<void>> = [];
  const adminCleanupFns: Array<() => Promise<void>> = [];
  let admin: { client: SupabaseClient<Database>; userId: string };

  beforeAll(async () => {
    const company = await createTestCompany();
    adminCleanupFns.push(() => deleteTestCompany(company.id));
    const profile = await createTestProfile({ companyId: company.id, role: "backoffice" });
    adminCleanupFns.push(() => deleteTestUser(profile.userId));
    admin = { client: await signInTestUser(profile.email, profile.password), userId: profile.userId };
  });

  afterAll(async () => {
    await runCleanup(adminCleanupFns);
  });

  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  it("companies: a grower reading the customer list (as distributor-customer's list panel does) sees only their own row, not other customers'", async () => {
    const ownCompany = await createTestCompany(`Test Grower ${randomUUID()}`, "grower");
    cleanupFns.push(() => deleteTestCompany(ownCompany.id));
    const customerCompany = await createTestCompany(`Test Customer ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const grower = await createTestProfile({ companyId: ownCompany.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));
    const growerClient = await signInTestUser(grower.email, grower.password);

    const read = await growerClient.from("companies").select("id").eq("type", "customer");
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);

    const backofficeRead = await admin.client.from("companies").select("id").eq("id", customerCompany.id);
    expect(backofficeRead.error).toBeNull();
    expect(backofficeRead.data).toEqual([{ id: customerCompany.id }]);
  });

  it("daily_orders and daily_order_products: a grower (non-owning, non-backoffice caller) reads nothing for a customer's order; backoffice reads everything", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const customerCompany = await createTestCompany(`Test Customer ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await admin.client.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs({ tradeDate }));
    expect(initiate.error).toBeNull();
    const day = initiate.data!;
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const openShop = await admin.client.rpc("open_shop", { p_can_see_prices: true });
    expect(openShop.error).toBeNull();

    const orderLine = await createTestOrderProductLine(day.id, customerCompany.id, grower.varietyId, 3);
    const [order] = await db.select().from(dailyOrders).where(eq(dailyOrders.id, orderLine.dailyOrderId));

    const outsider = await createTestProfile({ companyId: grower.companyId, role: "grower" });
    cleanupFns.push(() => deleteTestUser(outsider.userId));
    const outsiderClient = await signInTestUser(outsider.email, outsider.password);

    const ordersRead = await outsiderClient.from("daily_orders").select("id").eq("id", order!.id);
    expect(ordersRead.error).toBeNull();
    expect(ordersRead.data).toEqual([]);

    const linesRead = await outsiderClient.from("daily_order_products").select("id").eq("id", orderLine.id);
    expect(linesRead.error).toBeNull();
    expect(linesRead.data).toEqual([]);

    const backofficeOrdersRead = await admin.client.from("daily_orders").select("id").eq("id", order!.id);
    expect(backofficeOrdersRead.error).toBeNull();
    expect(backofficeOrdersRead.data).toEqual([{ id: order!.id }]);

    const backofficeLinesRead = await admin.client.from("daily_order_products").select("id").eq("id", orderLine.id);
    expect(backofficeLinesRead.error).toBeNull();
    expect(backofficeLinesRead.data).toEqual([{ id: orderLine.id }]);
  });

  it("arrangement_records: backoffice-only — even the owning customer can't read their own arrangement record directly", async () => {
    const grower = await createTestGrowerWithProduct();
    cleanupFns.push(() => deleteTestGrowerWithProduct(grower));
    const customerCompany = await createTestCompany(`Test Customer ${randomUUID()}`, "customer");
    cleanupFns.push(() => deleteTestCompany(customerCompany.id));

    const tradeDate = new Date().toISOString().slice(0, 10);
    const initiate = await admin.client.rpc("initiate_business_day", toInitiateBusinessDayRpcArgs({ tradeDate }));
    expect(initiate.error).toBeNull();
    const day = initiate.data!;
    cleanupFns.push(() => deleteTestTradingDay(day.id));

    const openShop = await admin.client.rpc("open_shop", { p_can_see_prices: true });
    expect(openShop.error).toBeNull();

    const pick = await getDailyPickForGrower(day.id, grower.companyId);
    const pickLine = await getPickProductLine(pick!.id, grower.varietyId);
    const updatePallets = await admin.client.rpc(
      "update_pick_product_pallets",
      toUpdatePickProductPalletsRpcArgs({ dailyPickProductId: pickLine!.id, palletsPicked: 5 }),
    );
    expect(updatePallets.error).toBeNull();

    const orderLine = await createTestOrderProductLine(day.id, customerCompany.id, grower.varietyId, 3);

    const createRecord = await admin.client.rpc(
      "create_arrangement_record",
      toCreateArrangementRecordRpcArgs({
        dailyPickProductId: pickLine!.id,
        dailyOrderProductId: orderLine.id,
        quantityPallets: 3,
      }),
    );
    expect(createRecord.error).toBeNull();
    const record = createRecord.data!;

    const customer = await createTestProfile({ companyId: customerCompany.id, role: "customer" });
    cleanupFns.push(() => deleteTestUser(customer.userId));
    const customerClient = await signInTestUser(customer.email, customer.password);

    const customerRead = await customerClient.from("arrangement_records").select("id").eq("id", record.id);
    expect(customerRead.error).toBeNull();
    expect(customerRead.data).toEqual([]);

    const backofficeRead = await admin.client.from("arrangement_records").select("id").eq("id", record.id);
    expect(backofficeRead.error).toBeNull();
    expect(backofficeRead.data).toEqual([{ id: record.id }]);
  }, 30000);
});
