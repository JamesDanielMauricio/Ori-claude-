import { authRouter } from "./routers/auth";
import { publicProcedure, router } from "./trpc";

// Per-role feature routers (auth, grower, customer, backoffice) get merged
// in here as they're built, one per packages/domain module.
export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const })),
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
