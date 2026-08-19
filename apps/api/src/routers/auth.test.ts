import { randomUUID } from "node:crypto";

import {
  createTestCompany,
  createTestProfile,
  deleteTestCompany,
  deleteTestUser,
  runCleanup,
} from "@ori/domain/auth/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { Context } from "../context";
import { appRouter } from "../router";

function contextWithCaller(caller: Context["caller"]): Context {
  return { req: {} as never, res: {} as never, caller };
}

describe("auth router — role guards", () => {
  const cleanupFns: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await runCleanup(cleanupFns);
  });

  it("rejects an unauthenticated caller from a role-scoped procedure", async () => {
    const trpcCaller = appRouter.createCaller(contextWithCaller(null));

    await expect(
      trpcCaller.auth.adminResetPassword({ targetUserId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a correctly-authenticated but wrong-role caller from a backoffice-only procedure", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const grower = await createTestProfile({ companyId: company.id, role: "grower" });
    cleanupFns.push(() => deleteTestUser(grower.userId));

    const trpcCaller = appRouter.createCaller(
      contextWithCaller({ userId: grower.userId, email: grower.email, role: "grower" }),
    );

    await expect(
      trpcCaller.auth.adminResetPassword({ targetUserId: grower.userId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a backoffice caller through bulkCreateUsers and adminResetPassword", async () => {
    const company = await createTestCompany();
    cleanupFns.push(() => deleteTestCompany(company.id));
    const admin = await createTestProfile({ companyId: company.id, role: "backoffice" });
    cleanupFns.push(() => deleteTestUser(admin.userId));

    const trpcCaller = appRouter.createCaller(
      contextWithCaller({ userId: admin.userId, email: admin.email, role: "backoffice" }),
    );

    const results = await trpcCaller.auth.bulkCreateUsers({
      rows: [
        {
          email: `grower-${randomUUID()}@example.test`,
          displayName: "New Grower",
          role: "grower",
          companyId: company.id,
        },
      ],
    });

    const [firstResult] = results;
    expect(firstResult?.status).toBe("created");
    if (firstResult?.status === "created") {
      cleanupFns.push(() => deleteTestUser(firstResult.userId));
    }

    const resetResult = await trpcCaller.auth.adminResetPassword({ targetUserId: admin.userId });
    expect(resetResult).toEqual({ ok: true });
  });
});
