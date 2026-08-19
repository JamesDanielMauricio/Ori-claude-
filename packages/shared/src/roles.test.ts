import { describe, expect, it } from "vitest";

import { resolveHomeRoute, userRoleSchema } from "./roles";

describe("userRoleSchema", () => {
  it("accepts the three login-capable roles", () => {
    expect(userRoleSchema.parse("backoffice")).toBe("backoffice");
    expect(userRoleSchema.parse("grower")).toBe("grower");
    expect(userRoleSchema.parse("customer")).toBe("customer");
  });

  it("rejects transporter — it never signs in, so it's not a login role", () => {
    expect(() => userRoleSchema.parse("transporter")).toThrow();
  });
});

describe("resolveHomeRoute", () => {
  it("maps each role to its home route", () => {
    expect(resolveHomeRoute("backoffice")).toBe("/backoffice");
    expect(resolveHomeRoute("grower")).toBe("/grower");
    expect(resolveHomeRoute("customer")).toBe("/customer");
  });
});
