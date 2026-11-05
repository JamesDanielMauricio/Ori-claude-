import { describe, expect, it } from "vitest";

import { growerProductsSaveInput } from "./grower-products-save-input";

// The "בשם מגדל" products dialog edits one thing — which products a grower has
// in season — but save_grower rewrites the grower's whole company row. So every
// other field must go back exactly as it was loaded, or saving the product list
// would quietly change (or erase) it.
describe("growerProductsSaveInput", () => {
  const grower = {
    id: "8b6f5b2e-1c1d-4c55-9a59-0f4f2b7e9a01",
    name: "משק כהן",
    status: "active" as const,
    default_pickup_time: "12:00:00",
    whatsapp_group_id: "120363000000000000",
    transporter_company_id: "5d0c2a52-8a43-4b8e-9b0e-3a5b6b1d2c03",
    contact_person_id: "0f1e2d3c-4b5a-4968-8776-655443322110",
  };
  const productVarietyIds = ["2a7c9e10-3b4d-4e5f-8a9b-0c1d2e3f4a5b"];

  it("keeps the grower's contact person, so saving the product list doesn't erase it", () => {
    expect(growerProductsSaveInput(grower, productVarietyIds).contactPersonId).toBe(
      grower.contact_person_id,
    );
  });

  it("saves a grower who has no contact person", () => {
    expect(
      growerProductsSaveInput({ ...grower, contact_person_id: null }, productVarietyIds)
        .contactPersonId,
    ).toBeNull();
  });

  it("changes nothing but the product list", () => {
    expect(growerProductsSaveInput(grower, productVarietyIds)).toEqual({
      id: grower.id,
      name: grower.name,
      status: "active",
      defaultPickupTime: "12:00:00",
      whatsappGroupId: "120363000000000000",
      productVarietyIds,
      transporterCompanyId: grower.transporter_company_id,
      contactPersonId: grower.contact_person_id,
    });
  });
});
