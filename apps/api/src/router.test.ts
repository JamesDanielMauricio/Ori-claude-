import { describe, expect, it } from "vitest";

import { appRouter } from "./router";

describe("appRouter", () => {
  it("reports healthy", async () => {
    const trpcCaller = appRouter.createCaller({
      req: {} as never,
      res: {} as never,
      caller: null,
    });
    await expect(trpcCaller.health()).resolves.toEqual({ status: "ok" });
  });
});
