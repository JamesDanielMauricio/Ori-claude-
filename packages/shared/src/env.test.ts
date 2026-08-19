import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadEnv } from "./env";

describe("loadEnv", () => {
  const schema = z.object({
    DATABASE_URL: z.string().url(),
  });

  it("parses a valid environment", () => {
    const env = loadEnv(schema, { DATABASE_URL: "postgres://localhost:5432/ori" });
    expect(env.DATABASE_URL).toBe("postgres://localhost:5432/ori");
  });

  it("throws a readable error for a missing variable", () => {
    expect(() => loadEnv(schema, {})).toThrowError(/DATABASE_URL/);
  });
});
