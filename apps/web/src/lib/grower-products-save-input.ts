import { saveGrowerInputSchema, type SaveGrowerInput } from "@ori/domain/reference-data";

import type { OversightGrower } from "@/lib/queries/oversight";

// What the "בשם מגדל" products dialog sends to save_grower. The dialog edits
// only the grower's in-season products, but save_grower rewrites the grower's
// whole company row (migration 0057), so every other field is sent back
// exactly as it was loaded — a field left out here would not stay as it is,
// it would be erased or, for contactPersonId, refused outright (the schema
// requires it to be present, even when it is null).
export function growerProductsSaveInput(
  grower: OversightGrower,
  productVarietyIds: string[],
): SaveGrowerInput {
  return saveGrowerInputSchema.parse({
    id: grower.id,
    name: grower.name,
    status: grower.status,
    defaultPickupTime: grower.default_pickup_time,
    whatsappGroupId: grower.whatsapp_group_id,
    productVarietyIds,
    transporterCompanyId: grower.transporter_company_id,
    contactPersonId: grower.contact_person_id,
  });
}
