// The sentence a failed action's toast shows, from whatever the action threw.
//
// Most failures already carry a readable message — a PostgREST error, one of
// the API's Hebrew tRPC errors. The exception is input validation: every save
// runs its form through a zod schema (packages/domain) before calling the
// server, and a ZodError's `message` is a JSON dump of its issues in English —
// which is what saving a blank name used to put in front of the user. It is
// recognised by `name` rather than `instanceof` because apps/web doesn't
// depend on zod directly.

interface ValidationIssue {
  code?: unknown;
  type?: unknown;
  expected?: unknown;
  validation?: unknown;
}

function validationMessage(issue: ValidationIssue | undefined): string {
  if (issue?.code === "too_small" && issue.type === "string") return "יש למלא את כל שדות החובה.";
  if (issue?.code === "invalid_string" && issue.validation === "uuid") return "יש לבחור ערך מהרשימה.";
  if (issue?.code === "invalid_type" && issue.expected === "integer") return "יש להזין מספר שלם.";
  if (issue?.code === "invalid_type" && issue.expected === "number") return "יש להזין מספר.";
  if (issue?.code === "too_small" && issue.type === "number") return "המספר שהוזן קטן מדי.";
  if (issue?.code === "too_big" && issue.type === "number") return "המספר שהוזן גדול מדי.";
  return "הנתונים שהוזנו אינם תקינים — בדוק את השדות ונסה שוב.";
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const { name, issues, message } = error as { name?: unknown; issues?: unknown; message?: unknown };
    if (name === "ZodError" && Array.isArray(issues)) {
      return validationMessage(issues[0] as ValidationIssue | undefined);
    }
    if (typeof message === "string" && message) return message;
  }
  return "שגיאה לא ידועה";
}
