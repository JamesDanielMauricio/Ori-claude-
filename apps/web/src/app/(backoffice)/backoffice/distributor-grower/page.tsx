"use client";

import {
  bootstrapGrowerPickInputSchema,
  sendPickReminderInputSchema,
  toBootstrapGrowerPickRpcArgs,
  toSendPickReminderRpcArgs,
} from "@ori/domain/grower";
import { saveGrowerInputSchema, toSaveGrowerRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { PickLinesEditor } from "@/components/grower/pick-lines-editor";
import { CheckboxList } from "@/components/reference-data/checkbox-list";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface GrowerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
}

interface DailyPickForDay {
  id: string;
  grower_company_id: string;
  status: "draft" | "submitted" | "closed";
  submitted_at: string | null;
  reminder_sent_at: string | null;
}

const STATUS_LABEL: Record<DailyPickForDay["status"], string> = {
  draft: "טיוטה",
  submitted: "נשלח",
  closed: "סגור",
};

// Distributor-facing "Grower Inventory Status" oversight (PRD:
// backoffice.md's "distributor+grower" tab — "Distributor as Grower
// View": a shared view used when the Distributor needs to act on a
// grower's behalf). Reuses the exact same PickLinesEditor the grower's
// own screen uses — update_pick_product_pallets/update_pick_product_details
// both already accept "the owning grower, or backoffice" — so editing a
// submission here is not a special case, just the same component under a
// backoffice session.
export default function DistributorAsGrowerPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [productsDialogOpen, setProductsDialogOpen] = useState(false);
  const [productDraft, setProductDraft] = useState<Set<string>>(new Set());
  const [savingProducts, setSavingProducts] = useState(false);

  const openDayQuery = useQuery({
    queryKey: ["grower-oversight", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trading_days").select("id, trade_date").neq("phase", "closed").maybeSingle();
      if (error) throw error;
      return data as { id: string; trade_date: string } | null;
    },
  });
  const openDayId = openDayQuery.data?.id;

  const growersQuery = useQuery({
    queryKey: ["grower-oversight", "growers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status, default_pickup_time, whatsapp_group_id, transporter_company_id")
        .eq("type", "grower")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as GrowerCompany[];
    },
  });

  const picksForDayQuery = useQuery({
    queryKey: ["grower-oversight", "picks-for-day", openDayId],
    enabled: !!openDayId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_picks")
        .select("id, grower_company_id, status, submitted_at, reminder_sent_at")
        .eq("trading_day_id", openDayId!);
      if (error) throw error;
      return data as DailyPickForDay[];
    },
  });

  const pickByGrowerId = useMemo(() => {
    const map = new Map<string, DailyPickForDay>();
    for (const pick of picksForDayQuery.data ?? []) map.set(pick.grower_company_id, pick);
    return map;
  }, [picksForDayQuery.data]);

  const catalogQuery = useQuery({
    queryKey: ["grower-oversight", "product-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select("id, name, product_families(name)")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string; product_families: { name: string } | null }>;
    },
  });

  const growerProductsQuery = useQuery({
    queryKey: ["grower-oversight", "grower-products", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase.from("grower_products").select("product_variety_id").eq("company_id", selectedId!);
      if (error) throw error;
      return data.map((row) => row.product_variety_id);
    },
  });

  useEffect(() => {
    if (productsDialogOpen && growerProductsQuery.data) {
      setProductDraft(new Set(growerProductsQuery.data));
    }
  }, [productsDialogOpen, growerProductsQuery.data]);

  const catalogOptions = useMemo(
    () =>
      (catalogQuery.data ?? []).map((product) => ({
        id: product.id,
        label: product.product_families?.name ? `${product.product_families.name} — ${product.name}` : product.name,
      })),
    [catalogQuery.data],
  );

  const selected = growersQuery.data?.find((row) => row.id === selectedId) ?? null;
  const selectedPick = selectedId ? (pickByGrowerId.get(selectedId) ?? null) : null;

  const saveProductsMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("no grower selected");
      const saveInput = saveGrowerInputSchema.parse({
        id: selected.id,
        name: selected.name,
        status: selected.status,
        defaultPickupTime: selected.default_pickup_time,
        whatsappGroupId: selected.whatsapp_group_id,
        productVarietyIds: [...productDraft],
        // Preserved as-is — this dialog only edits in-season products;
        // save_grower replaces the whole row, so an unset value here
        // would silently wipe out an existing transporter assignment.
        transporterCompanyId: selected.transporter_company_id,
      });
      const { error: saveError } = await supabase.rpc("save_grower", toSaveGrowerRpcArgs(saveInput));
      if (saveError) throw saveError;

      if (openDayId) {
        const bootstrapInput = bootstrapGrowerPickInputSchema.parse({
          tradingDayId: openDayId,
          growerCompanyId: selected.id,
        });
        const { error: bootstrapError } = await supabase.rpc(
          "bootstrap_grower_pick",
          toBootstrapGrowerPickRpcArgs(bootstrapInput),
        );
        if (bootstrapError) throw bootstrapError;
      }
    },
    onSuccess: () => {
      showToast("רשימת המוצרים עודכנה.", "success");
      setProductsDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["grower-oversight", "grower-products", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["grower-oversight", "picks-for-day", openDayId] });
      if (selectedPick) {
        void queryClient.invalidateQueries({ queryKey: ["grower", "pick-lines", selectedPick.id] });
      }
    },
    onError: (error: { message?: string }) => {
      showToast(`העדכון נכשל: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const reminderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPick) throw new Error("no pick to remind about");
      const input = sendPickReminderInputSchema.parse({ dailyPickId: selectedPick.id });
      const { error } = await supabase.rpc("send_pick_reminder", toSendPickReminderRpcArgs(input));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("התזכורת נשלחה.", "success");
      void queryClient.invalidateQueries({ queryKey: ["grower-oversight", "picks-for-day", openDayId] });
    },
    onError: (error: { message?: string }) => {
      showToast(`שליחת התזכורת נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  function toggleProduct(id: string) {
    setProductDraft((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSaveProducts() {
    setSavingProducts(true);
    saveProductsMutation.mutate(undefined, { onSettled: () => setSavingProducts(false) });
  }

  return (
    <>
      <ListDetailLayout
        header={<PageHeader title="בשם מגדל" subtitle="צפייה ועריכה של ליקוטי היום בשם כל מגדל, ושליחת תזכורות." />}
        list={
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
            {growersQuery.isLoading || (openDayId && picksForDayQuery.isLoading) ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <ul>
                {growersQuery.data?.map((row) => {
                  const pick = pickByGrowerId.get(row.id);
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        className={`flex w-full items-center justify-between border-b border-border px-4 py-3 text-start text-sm hover:bg-canvas ${
                          row.id === selectedId ? "bg-canvas font-medium" : ""
                        }`}
                      >
                        <span>{row.name}</span>
                        <span className="text-xs text-ink-muted">{pick ? STATUS_LABEL[pick.status] : "אין ליקוט"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        }
        detail={
          !selected ? (
            <p className="text-sm text-ink-muted">בחר מגדל מהרשימה.</p>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold">{selected.name}</h1>
                  <p className="text-sm text-ink-muted">
                    {selectedPick ? (
                      <>
                        סטטוס: {STATUS_LABEL[selectedPick.status]}
                        {selectedPick.submitted_at && ` · נשלח ב-${new Date(selectedPick.submitted_at).toLocaleString("he-IL")}`}
                        {selectedPick.reminder_sent_at &&
                          ` · תזכורת נשלחה ב-${new Date(selectedPick.reminder_sent_at).toLocaleString("he-IL")}`}
                      </>
                    ) : (
                      "אין ליקוט עבור מגדל זה היום."
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => setProductsDialogOpen(true)}>
                    ערוך מוצרים בעונה
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => reminderMutation.mutate()}
                    disabled={!selectedPick || selectedPick.status === "closed" || reminderMutation.isPending}
                  >
                    {reminderMutation.isPending ? "שולח…" : "שלח תזכורת"}
                  </Button>
                </div>
              </div>

              {selectedPick ? (
                <PickLinesEditor dailyPickId={selectedPick.id} pickStatus={selectedPick.status} />
              ) : (
                <p className="text-sm text-ink-muted">
                  הוסף מוצרים בעונה כדי ליצור ליקוט עבור מגדל זה.
                </p>
              )}
            </div>
          )
        }
      />
      <Dialog open={productsDialogOpen} onClose={() => setProductsDialogOpen(false)} title="מוצרים בעונה">
        <div className="flex flex-col gap-4">
          <CheckboxList options={catalogOptions} selectedIds={productDraft} onToggle={toggleProduct} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setProductsDialogOpen(false)}>
              ביטול
            </Button>
            <Button type="button" onClick={handleSaveProducts} disabled={savingProducts}>
              {savingProducts ? "שומר…" : "שמור"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
