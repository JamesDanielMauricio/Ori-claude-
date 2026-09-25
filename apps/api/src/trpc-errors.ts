import {
  RecoveryLinkSendFailedError,
  RecoveryLinkUndeliverableError,
  UserNotFoundError,
  type RecoveryLinkUndeliverableReason,
} from "@ori/domain/auth";
import { TRPCError } from "@trpc/server";

// What the admin reads when a reset is refused. Every one of these is
// raised before anything is changed, so each says so implicitly: nothing
// happened, fix this and try again.
const UNDELIVERABLE_MESSAGE: Record<RecoveryLinkUndeliverableReason, string> = {
  self_reset:
    "לא ניתן לאפס כאן את הסיסמה של החשבון שלך. לשינוי הסיסמה שלך השתמש במסך קביעת הסיסמה.",
  no_phone: "למשתמש אין מספר טלפון בפרופיל, ולכן אי אפשר לשלוח לו את הקישור ב-WhatsApp. הוסף מספר במסך המשתמשים ונסה שוב.",
  invalid_phone:
    "מספר הטלפון בפרופיל של המשתמש אינו מספר ישראלי תקין. תקן אותו במסך המשתמשים ונסה שוב.",
  whatsapp_disabled: "הודעות WhatsApp כבויות בהגדרות המערכת, ולכן הקישור לא נשלח. הפעל אותן ונסה שוב.",
  whatsapp_not_configured:
    "שליחת WhatsApp לא הוגדרה בשרת (חסרים פרטי ההתחברות ל-Green API), ולכן הקישור לא נשלח.",
  dev_phone_missing:
    "המערכת במצב פיתוח, ולא הוגדר מספר בדיקה לקבלת הודעות WhatsApp — ההודעה לא תישלח למשתמש האמיתי במצב זה.",
};

// Translates domain errors (which know nothing about HTTP/tRPC) into the
// appropriate TRPCError.
export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof UserNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: "המשתמש לא נמצא.", cause: error });
  }
  if (error instanceof RecoveryLinkUndeliverableError) {
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: UNDELIVERABLE_MESSAGE[error.reason],
      cause: error,
    });
  }
  if (error instanceof RecoveryLinkSendFailedError) {
    // Raised only after the reset was applied — the admin has to know the
    // user is already signed out and must set a new password, and that
    // sending again is safe (a new link replaces the old one).
    return new TRPCError({
      code: "BAD_GATEWAY",
      message: `שליחת הקישור ב-WhatsApp נכשלה (${error.detail}). המשתמש כבר נותק ויתבקש לקבוע סיסמה חדשה — אפשר לנסות לשלוח שוב.`,
      cause: error,
    });
  }
  if (error instanceof TRPCError) {
    return error;
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error });
}
