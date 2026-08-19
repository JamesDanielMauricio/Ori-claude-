import { UserNotFoundError } from "@ori/domain/auth";
import { TRPCError } from "@trpc/server";

// Translates domain errors (which know nothing about HTTP/tRPC) into the
// appropriate TRPCError.
export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof UserNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  if (error instanceof TRPCError) {
    return error;
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error });
}
