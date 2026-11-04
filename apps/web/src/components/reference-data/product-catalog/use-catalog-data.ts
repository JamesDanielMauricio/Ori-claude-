import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { referenceDataQueries } from "@/lib/queries/reference-data";

// Everything the Products screen reads: families, varieties, customer names
// (for the caps column) and every variety's caps — plus the two lookups
// built from them. All four definitions live in lib/queries/reference-data.
export function useCatalogData() {
  const familiesQuery = useQuery(referenceDataQueries.productFamilies());
  const familyById = useMemo(
    () => new Map((familiesQuery.data ?? []).map((family) => [family.id, family])),
    [familiesQuery.data],
  );

  // Without families embedded: each family's name, category and photo come
  // from familiesQuery via `familyById` (see referenceDataQueries.products).
  const productsQuery = useQuery(referenceDataQueries.products());

  const customersQuery = useQuery(referenceDataQueries.customersForCaps());
  const customerNameById = useMemo(
    () => new Map((customersQuery.data ?? []).map((row) => [row.id, row.name])),
    [customersQuery.data],
  );

  // Every variety's per-customer caps in ONE read (see
  // referenceDataQueries.productCustomerCaps).
  const capsQuery = useQuery(referenceDataQueries.productCustomerCaps());

  return { familiesQuery, familyById, productsQuery, customersQuery, customerNameById, capsQuery };
}
