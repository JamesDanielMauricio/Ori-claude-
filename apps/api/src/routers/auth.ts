import {
  adminResetPassword,
  bulkCreateUsers,
  createWhatsAppRecoveryDelivery,
  deleteUser,
  listUserEmails,
} from "@ori/domain/auth";
import { userRoleSchema } from "@ori/shared/roles";
import { z } from "zod";

import { backofficeProcedure, router } from "../trpc";
import { toTRPCError } from "../trpc-errors";

// Where a reset link lands after Supabase verifies it: /change-password on
// the site the admin is using, taken from the request's Origin header — the
// same page the self-service reset (reset-password.tsx) sends people to.
//
// SECURITY: this only chooses a redirect target, and Supabase itself ignores
// any target not on the project's redirect allow-list (falling back to the
// Site URL), so a forged Origin can't send the link's session anywhere
// unapproved. Anything that isn't a plain http(s) origin is dropped here
// rather than passed along.
function changePasswordUrl(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || url.protocol === "http:"
      ? `${url.origin}/change-password`
      : undefined;
  } catch {
    return undefined;
  }
}

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

  // Sends the target a one-time recovery link on WhatsApp, to the phone on
  // their own profile, and signs them out everywhere — see
  // packages/domain/src/auth/admin-reset-password.ts. The admin gets back
  // only whether it went out and the number's last four digits.
  adminResetPassword: backofficeProcedure
    .input(z.object({ targetUserId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const receipt = await adminResetPassword({
          targetUserId: input.targetUserId,
          actorUserId: ctx.caller.userId,
          delivery: createWhatsAppRecoveryDelivery(),
          redirectTo: changePasswordUrl(ctx.req?.headers?.origin),
        });
        return {
          ok: true as const,
          lastDigits: receipt.lastDigits,
          devRedirected: receipt.devRedirected,
        };
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
