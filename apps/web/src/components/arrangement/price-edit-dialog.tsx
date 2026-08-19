"use client";

import { saveProductInputSchema, toSaveProductRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

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

  const varietyQuery = useQuery({
    queryKey: ["arrangement", "product-variety", varietyId],
    enabled: !!varietyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select(
          "id, family_id, name, sizes, pack_type, price, price_range_from, price_range_to, price_type, no_overbooking, highlight_price_fluctuations, is_seasonal_available, version, product_families(name)",
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
      return data.map((row) => ({ customerCompanyId: row.customer_company_id, palletCap: row.pallet_cap }));
    },
  });

  useEffect(() => {
    if (varietyQuery.data) {
      setPrice(varietyQuery.data.price ?? "");
      setPriceRangeFrom(varietyQuery.data.price_range_from ?? "");
      setPriceRangeTo(varietyQuery.data.price_range_to ?? "");
      setPriceType(varietyQuery.data.price_type ?? "");
    }
  }, [varietyQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const row = varietyQuery.data!;
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
        expectedVersion: row.version,
        customerPalletCaps: capsQuery.data ?? [],
      });
      const { error } = await supabase.rpc("save_product", toSaveProductRpcArgs(input));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("המחיר עודכן.", "success");
      void queryClient.invalidateQueries({ queryKey: ["arrangement"] });
      onClose();
    },
    onError: (error: { message?: string }) => {
      showToast(`עדכון המחיר נכשל: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const title = varietyQuery.data
    ? varietyQuery.data.product_families?.name
      ? `מחיר — ${varietyQuery.data.product_families.name} — ${varietyQuery.data.name}`
      : `מחיר — ${varietyQuery.data.name}`
    : "מחיר";

  return (
    <Dialog open={!!varietyId} onClose={onClose} title={title}>
      {varietyQuery.isLoading ? (
        <p className="text-sm text-ink-muted">טוען…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
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
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "שומר…" : "שמור"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
