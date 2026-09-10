import { adminResetPassword, bulkCreateUsers, deleteUser, listUserEmails } from "@ori/domain/auth";
import { userRoleSchema } from "@ori/shared/roles";
import { z } from "zod";

import { backofficeProcedure, router } from "../trpc";
import { toTRPCError } from "../trpc-errors";

// Everything else (sign-in, sign-out, session, forced/voluntary password
// change, self-service reset) is pure supabase-js calls made directly from
// apps/web — no API round-trip needed, since Supabase IS the identity
// provider. This router only holds the two operations that require the
// service-role key (bypassing Row Level Security) and therefore must run
// in a trusted server context — see docs/ARCHITECTURE.md and
// packages/domain/src/auth/supabase-clients.ts.
export const authRouter = router({
  bulkCreateUsers: backofficeProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              email: z.string().email(),
              displayName: z.string().min(1),
              role: userRoleSchema,
              companyId: z.string().uuid(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await bulkCreateUsers({ rows: input.rows });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  adminResetPassword: backofficeProcedure
    .input(z.object({ targetUserId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        await adminResetPassword({ targetUserId: input.targetUserId });
        return { ok: true as const };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  // The Users screen's email column — `auth.users.email` isn't reachable
  // from the browser's own Supabase client (PostgREST exposes `public`
  // only), so the screen reads it here and joins it onto the profiles rows
  // it already has. Read-only: changing a login email is an auth operation,
  // not a profile edit.
  listUserEmails: backofficeProcedure.query(async () => {
    try {
      return await listUserEmails();
    } catch (error) {
      throw toTRPCError(error);
    }
  }),

  // The Users screen's delete action — needs the service-role Admin API to
  // remove the `auth.users` identity itself, which RLS can't reach (see
  // packages/domain/src/auth/delete-user.ts).
  deleteUser: backofficeProcedure
    .input(z.object({ targetUserId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        await deleteUser({ targetUserId: input.targetUserId });
        return { ok: true as const };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
