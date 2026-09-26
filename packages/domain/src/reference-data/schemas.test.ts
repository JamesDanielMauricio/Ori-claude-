import { describe, expect, it } from "vitest";

import {
  saveCustomerInputSchema,
  saveGrowerInputSchema,
  saveTransporterInputSchema,
} from "./schemas";

const company = { id: null, name: "חברת בדיקה", status: "active" as const };

// Each company screen saves through its own schema, so each one is checked:
// a schema that skipped the normalization would let that screen store a
// suffixed id that dispatch then doubles.
const parseGroupId = {
  grower: (whatsappGroupId: string | null) =>
    saveGrowerInputSchema.parse({
      ...company,
      defaultPickupTime: null,
      productVarietyIds: [],
      transporterCompanyId: null,
      contactPersonId: null,
      whatsappGroupId,
    }).whatsappGroupId,
  customer: (whatsappGroupId: string | null) =>
    saveCustomerInputSchema.parse({
      ...company,
      canSeeProductPrices: null,
      contactPersonId: null,
      whatsappGroupId,
    }).whatsappGroupId,
  transporter: (whatsappGroupId: string | null) =>
    saveTransporterInputSchema.parse({ ...company, contactPersonId: null, whatsappGroupId })
      .whatsappGroupId,
};

describe.each(Object.entries(parseGroupId))("%s whatsappGroupId", (_, parse) => {
  it("strips a pasted @g.us suffix", () => {
    expect(parse("120363417140195112@g.us")).toBe("120363417140195112");
  });

  it("trims surrounding whitespace, including around a suffix", () => {
    expect(parse(" 120363417140195112@g.us ")).toBe("120363417140195112");
  });

  it("keeps a bare id as it is", () => {
    expect(parse("120363417140195112")).toBe("120363417140195112");
  });

  it("stores a blank field as no group", () => {
    expect(parse(null)).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
    expect(parse("@g.us")).toBeNull();
  });
});
