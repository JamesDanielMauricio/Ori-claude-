import {
  RecoveryLinkSendFailedError,
  RecoveryLinkUndeliverableError,
  UserNotFoundError,
  type RecoveryLinkUndeliverableReason,
} from "@ori/domain/auth";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { toTRPCError } from "./trpc-errors";

// Pure: builds errors in memory, touches no database.
describe("toTRPCError", () => {
  const reasons: RecoveryLinkUndeliverableReason[] = [
    "self_reset",
    "no_phone",
    "invalid_phone",
    "whatsapp_disabled",
    "whatsapp_not_configured",
    "dev_phone_missing",
  ];

  it.each(reasons)("turns the %s refusal into PRECONDITION_FAILED with a Hebrew message", (reason) => {
    const mapped = toTRPCError(new RecoveryLinkUndeliverableError(reason));
    expect(mapped.code).toBe("PRECONDITION_FAILED");
    expect(mapped.message).toMatch(/[֐-׿]/);
    expect(mapped.message).not.toContain(reason);
  });

  it("tells the admin a failed send happened after the user was signed out, and that retrying is safe", () => {
    const mapped = toTRPCError(new RecoveryLinkSendFailedError("Green API responded 500"));
    expect(mapped.code).toBe("BAD_GATEWAY");
    expect(mapped.message).toContain("Green API responded 500");
    expect(mapped.message).toContain("נותק");
    expect(mapped.message).toContain("לנסות לשלוח שוב");
  });

  it("maps a missing user to NOT_FOUND in Hebrew", () => {
    const mapped = toTRPCError(new UserNotFoundError());
    expect(mapped.code).toBe("NOT_FOUND");
    expect(mapped.message).toBe("המשתמש לא נמצא.");
  });

  it("passes TRPCErrors through and wraps anything else as INTERNAL_SERVER_ERROR", () => {
    const original = new TRPCError({ code: "FORBIDDEN" });
    expect(toTRPCError(original)).toBe(original);
    expect(toTRPCError(new Error("boom")).code).toBe("INTERNAL_SERVER_ERROR");
  });
});
