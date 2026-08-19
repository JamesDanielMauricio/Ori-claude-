import { z } from "zod";

/**
 * Parses `process.env` against a Zod schema and throws a readable error on
 * startup rather than letting an app run with a missing/malformed config
 * value. Each app defines its own schema (only the variables it needs) and
 * calls this once at boot.
 */
export function loadEnv<Schema extends z.ZodTypeAny>(
  schema: Schema,
  source: Record<string, string | undefined> = process.env,
): z.infer<Schema> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
