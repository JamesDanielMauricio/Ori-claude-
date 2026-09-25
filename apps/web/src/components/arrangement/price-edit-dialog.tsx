import { saveProductInputSchema, toSaveProductRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { QueryError } from "@/components/ui/query-error";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/error-message";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { formatVarietyName } from "@/lib/variety-label";

interface ProductVarietyRow {
  id: string;
  family_id: string;
  name: string;
  sizes: string | null;
  pack_type: "pallets" | "crates" | null;
  price: string | null;
  price_range_from: string | null;
  price_range_to: string | null;
  price_type: string | null;
  no_overbooking: string;
  highlight_price_fluctuations: boolean;
  is_seasonal_available: boolean;
  number_of_orders_per_customer: number | null;
  version: number;
}

// Per-variety price configuration, launched from the arrangement
// workspace. Reuses save_product (packages/domain/src/reference-data) —
// the same version-guarded, full-row RPC the Products screen uses —
// rather than a new price-only RPC: a price is just one field on the
// variety row, and save_product already carries the R7 conflict guard
// this write needs just as much as any other product edit.
export function PriceEditDialog({
  varietyId,
  onClose,
}: {
  varietyId: string | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [price, setPrice] = useState("");
  const [priceRangeFrom, setPriceRangeFrom] = useState("");
  const [priceRangeTo, setPriceRangeTo] = useState("");
  const [priceType, setPriceType] = useState("");

  const varietyQueryKey = ["arrangement", "product-variety", varietyId] as const;

  const varietyQuery = useQuery({
    queryKey: varietyQueryKey,
    enabled: !!varietyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select(
          "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, number_of_orders_per_customer, version, product_families(name)",
        )
        .eq("id", varietyId!)
        .single();
      if (error) throw error;
      return data as ProductVarietyRow & { product_families: { name: string } | null };
    },
  });

  const capsQuery = useQuery({
    queryKey: ["arrangement", "product-customer-caps", varietyId],
    enabled: !!varietyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_customer_caps")
        .select("customer_company_id, pallet_cap")
        .eq("product_variety_id", varietyId!);
      if (error) throw error;
      return data.map((row) => ({
        customerCompanyId: row.customer_company_id,
        palletCap: row.pallet_cap,
      }));
    },
  });

  // Seeded once per variety, not on every change of varietyQuery.data.
  //
  // Keyed on the data object, this re-ran on any refetch — and React Query
  // refetches on window focus once the query is stale (30s, lib/providers.tsx).
  // A distributor who opened this dialog, typed a new price, checked something
  // in another window and came back found their entry replaced by the old
  // stored value, with no indication anything had been discarded. Seeding from
  // the id means a refetch can no longer overwrite what someone is typing.
  const [seededVarietyId, setSeededVarietyId] = useState<string | null>(null);
  useEffect(() => {
    // Closing clears the marker, so reopening the SAME variety seeds again
    // from the server rather than resurrecting the last thing typed into a
    // dialog that was dismissed. This component stays mounted between
    // openings — varietyId just goes back to null.
    if (varietyId === null) {
      setSeededVarietyId(null);
      return;
    }
    if (!varietyQuery.data || seededVarietyId === varietyId) return;
    setSeededVarietyId(varietyId);
    setPrice(varietyQuery.data.price ?? "");
    setPriceRangeFrom(varietyQuery.data.price_range_from ?? "");
    setPriceRangeTo(varietyQuery.data.price_range_to ?? "");
    setPriceType(varietyQuery.data.price_type ?? "");
  }, [varietyQuery.data, varietyId, seededVarietyId]);

  type VarietyRow = ProductVarietyRow & { product_families: { name: string } | null };

  const saveOptimistic = optimisticUpdate<VarietyRow, void>(
    queryClient,
    varietyQueryKey,
    (row) =>
      row
        ? {
            ...row,
            price: price === "" ? null : price,
            price_range_from: priceRangeFrom === "" ? null : priceRangeFrom,
            price_range_to: priceRangeTo === "" ? null : priceRangeTo,
            price_type: priceType || null,
          }
        : row,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const row = varietyQuery.data;
      const caps = capsQuery.data;
      // save_product REPLACES the variety's per-customer caps with whatever
      // list it is given, deleting any cap left out. Caps that haven't loaded
      // (still fetching, or the read failed) are unknown, not empty — sending
      // [] in their place would silently delete every cap on this product.
      // The save button is disabled until both reads land; this is the
      // backstop behind it.
      if (!row || !caps) throw new Error("נתוני המוצר עדיין לא נטענו");
      const input = saveProductInputSchema.parse({
        id: row.id,
        familyId: row.family_id,
        name: row.name,
        sizes: row.sizes,
        packType: row.pack_type,
        price: price === "" ? null : Number(price),
        priceRangeFrom: priceRangeFrom === "" ? null : Number(priceRangeFrom),
        priceRangeTo: priceRangeTo === "" ? null : Number(priceRangeTo),
        priceType: priceType || null,
        noOverbooking: Number(row.no_overbooking),
        highlightPriceFluctuations: row.highlight_price_fluctuations,
        isSeasonalAvailable: row.is_seasonal_available,
        // This dialog only edits price — passed through unchanged, same as
        // noOverbooking/isSeasonalAvailable above.
        numberOfOrdersPerCustomer: row.number_of_orders_per_customer,
        expectedVersion: row.version,
        customerPalletCaps: caps,
      });
      const { error } = await supabase.rpc("save_product", toSaveProductRpcArgs(input));
      if (error) throw error;
    },
    onMutate: saveOptimistic.onMutate,
    onSuccess: () => {
      showToast("המחיר עודכן.", "success");
      void queryClient.invalidateQueries({ queryKey: ["arrangement"] });
      onClose();
    },
    onError: mergeOnError(saveOptimistic.onError, (error: { message?: string }) => {
      showToast(`עדכון המחיר נכשל: ${errorMessage(error)}`, "error");
    }),
  });

  const title = varietyQuery.data
    ? varietyQuery.data.product_families?.name
      ? `מחיר — ${varietyQuery.data.product_families.name} — ${formatVarietyName(varietyQuery.data.name, varietyQuery.data.sizes)}`
      : `מחיר — ${formatVarietyName(varietyQuery.data.name, varietyQuery.data.sizes)}`
    : "מחיר";

  return (
    <Dialog open={!!varietyId} onClose={onClose} title={title}>
      {varietyQuery.isLoading || capsQuery.isLoading ? (
        <p className="text-sm text-ink-muted">טוען…</p>
      ) : varietyQuery.isError || capsQuery.isError ? (
        <QueryError
          what="נתוני המוצר"
          onRetry={() => {
            void varietyQuery.refetch();
            void capsQuery.refetch();
          }}
          retrying={varietyQuery.isFetching || capsQuery.isFetching}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="מחיר" htmlFor="arr-price">
              <input
                id="arr-price"
                type="number"
                step="0.01"
                className={inputClassName}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </FormField>
            <FormField label="טווח מ-" htmlFor="arr-price-from">
              <input
                id="arr-price-from"
                type="number"
                step="0.01"
                className={inputClassName}
                value={priceRangeFrom}
                onChange={(event) => setPriceRangeFrom(event.target.value)}
              />
            </FormField>
            <FormField label="טווח עד" htmlFor="arr-price-to">
              <input
                id="arr-price-to"
                type="number"
                step="0.01"
                className={inputClassName}
                value={priceRangeTo}
                onChange={(event) => setPriceRangeTo(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="סוג תמחור" htmlFor="arr-price-type">
            <input
              id="arr-price-type"
              className={inputClassName}
              value={priceType}
              onChange={(event) => setPriceType(event.target.value)}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              ביטול
            </Button>
            <Button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !varietyQuery.data || !capsQuery.data}
            >
              {saveMutation.isPending ? "שומר…" : "שמור"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
