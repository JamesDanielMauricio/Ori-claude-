import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { referenceDataQueries } from "@/lib/queries/reference-data";

// Everything the Products screen reads: families, varieties and every
// variety's per-customer caps — plus the family lookup. The caps are no longer
// shown or edited; they are read only so a save sends them back unchanged
// (save_product replaces them with whatever it is sent). All three
// definitions live in lib/queries/reference-data.
export function useCatalogData() {
  const familiesQuery = useQuery(referenceDataQueries.productFamilies());
  const familyById = useMemo(
    () => new Map((familiesQuery.data ?? []).map((family) => [family.id, family])),
    [familiesQuery.data],
  );

  // Without families embedded: each family's name, category and photo come
  // from familiesQuery via `familyById` (see referenceDataQueries.products).
  const productsQuery = useQuery(referenceDataQueries.products());

  // Every variety's per-customer caps in ONE read (see
  // referenceDataQueries.productCustomerCaps).
  const capsQuery = useQuery(referenceDataQueries.productCustomerCaps());

  return { familiesQuery, familyById, productsQuery, capsQuery };
}
