import type { UserRole } from "@ori/shared/roles";
import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.caller) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, caller: ctx.caller } });
});

// The single, centralized role guard every role-scoped procedure goes
// through — one named check (R5). RLS (see docs/SCHEMA_DECISIONS.md) is
// the primary authorization layer for direct client access to the
// database; this guard is the equivalent boundary for apps/api's own
// trusted-server operations, which run with elevated privilege
// (service-role Supabase Admin API calls) that RLS can't constrain.
export function requireRole(role: UserRole | readonly UserRole[]) {
  const allowed = Array.isArray(role) ? role : [role];

  return protectedProcedure.use(({ ctx, next }) => {
    if (!allowed.includes(ctx.caller.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "WRONG_ROLE" });
    }
    return next({ ctx });
  });
}

export const backofficeProcedure = requireRole("backoffice");
