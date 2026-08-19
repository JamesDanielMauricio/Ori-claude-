"use client";

import {
  toDeleteArrangementRecordRpcArgs,
  toUpdateArrangementRecordRpcArgs,
  updateArrangementRecordInputSchema,
} from "@ori/domain/arrangement";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PriceEditDialog } from "@/components/arrangement/price-edit-dialog";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface TradingDay {
  id: string;
  trade_date: string;
  phase: "initiated" | "shop_open" | "shop_closed" | "closed";
}

interface DailyArrangement {
  id: string;
  status: "open" | "closed";
}

interface PickHeader {
  id: string;
  grower_company_id: string;
}

interface PickLine {
  id: string;
  daily_pick_id: string;
  product_variety_id: string;
  pallets_picked: string;
}

interface OrderHeader {
  id: string;
  customer_company_id: string;
}

interface OrderLine {
  id: string;
  daily_order_id: string;
  product_variety_id: string;
  pallets_ordered: string;
}

interface Variety {
  id: string;
  name: string;
  family_id: string;
  product_families: { name: string } | null;
}

interface ArrangementRecord {
  id: string;
  daily_pick_product_id: string;
  daily_order_product_id: string;
  customer_company_id: string;
  quantity_pallets: number;
  price: number | null;
  price_type: string | null;
}

interface Company {
  id: string;
  name: string;
}

type ViewMode = "by-product" | "by-grower";

// The distributor's matchmaking workspace (PRD: arrangement-view.md).
// "By-grower" and "by-product" aren't two routes — the PRD's own ASCII
// sketch shows ONE screen with pooled supply/demand side by side and a
// single records table below; this page reads that same underlying data
// regardless of viewMode, only the records table's primary grouping
// changes (mirrors the customer catalog's "one function, two groupings"
// shape from Prompt 7). New records are created via /backoffice/new-arrangement
// (a separate focused wizard, per new-arrangement-wizard.md); this page
// edits/deletes existing ones and drives the terminal Close Arrangement
// transaction.
export default function ArrangementPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("by-product");
  const [priceEditVarietyId, setPriceEditVarietyId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const dayQuery = useQuery({
    queryKey: ["arrangement", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date, phase")
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as TradingDay | null;
    },
  });
  const day = dayQuery.data;

  const arrangementQuery = useQuery({
    queryKey: ["arrangement", "daily-arrangement", day?.id],
    enabled: !!day,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_arrangements")
        .select("id, status")
        .eq("trading_day_id", day!.id)
        .single();
      if (error) throw error;
      return data as DailyArrangement;
    },
  });
  const arrangement = arrangementQuery.data;

  const picksQuery = useQuery({
    queryKey: ["arrangement", "picks", day?.id],
    enabled: !!day,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_picks")
        .select("id, grower_company_id")
        .eq("trading_day_id", day!.id);
      if (error) throw error;
      return data as PickHeader[];
    },
  });

  const pickLinesQuery = useQuery({
    queryKey: ["arrangement", "pick-lines", day?.id],
    enabled: !!picksQuery.data?.length,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_pick_products")
        .select("id, daily_pick_id, product_variety_id, pallets_picked")
        .in("daily_pick_id", picksQuery.data!.map((pick) => pick.id));
      if (error) throw error;
      return data as PickLine[];
    },
  });

  const ordersQuery = useQuery({
    queryKey: ["arrangement", "orders", day?.id],
    enabled: !!day,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_orders")
        .select("id, customer_company_id")
        .eq("trading_day_id", day!.id);
      if (error) throw error;
      return data as OrderHeader[];
    },
  });

  const orderLinesQuery = useQuery({
    queryKey: ["arrangement", "order-lines", day?.id],
    enabled: !!ordersQuery.data?.length,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_order_products")
        .select("id, daily_order_id, product_variety_id, pallets_ordered")
        .in("daily_order_id", ordersQuery.data!.map((order) => order.id));
      if (error) throw error;
      return data as OrderLine[];
    },
  });

  const recordsQuery = useQuery({
    queryKey: ["arrangement", "records", arrangement?.id],
    enabled: !!arrangement,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arrangement_records")
        .select("id, daily_pick_product_id, daily_order_product_id, customer_company_id, quantity_pallets, price, price_type")
        .eq("daily_arrangement_id", arrangement!.id);
      if (error) throw error;
      // numeric columns come back as bare JSON numbers over PostgREST, not
      // decimal-preserving strings — see docs/SCHEMA_DECISIONS.md.
      return data as unknown as ArrangementRecord[];
    },
  });

  const varietyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of pickLinesQuery.data ?? []) ids.add(line.product_variety_id);
    for (const line of orderLinesQuery.data ?? []) ids.add(line.product_variety_id);
    return [...ids];
  }, [pickLinesQuery.data, orderLinesQuery.data]);

  const varietiesQuery = useQuery({
    queryKey: ["arrangement", "varieties", varietyIds],
    enabled: varietyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select("id, name, family_id, product_families(name)")
        .in("id", varietyIds);
      if (error) throw error;
      return data as unknown as Variety[];
    },
  });

  const companiesQuery = useQuery({
    queryKey: ["arrangement", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name").in("type", ["grower", "customer"]);
      if (error) throw error;
      return data as Company[];
    },
  });

  const companyNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const company of companiesQuery.data ?? []) map.set(company.id, company.name);
    return map;
  }, [companiesQuery.data]);

  const varietyById = useMemo(() => {
    const map = new Map<string, Variety>();
    for (const variety of varietiesQuery.data ?? []) map.set(variety.id, variety);
    return map;
  }, [varietiesQuery.data]);

  const growerIdByPickId = useMemo(() => {
    const map = new Map<string, string>();
    for (const pick of picksQuery.data ?? []) map.set(pick.id, pick.grower_company_id);
    return map;
  }, [picksQuery.data]);

  const customerIdByOrderId = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of ordersQuery.data ?? []) map.set(order.id, order.customer_company_id);
    return map;
  }, [ordersQuery.data]);

  const pickLineById = useMemo(() => {
    const map = new Map<string, PickLine>();
    for (const line of pickLinesQuery.data ?? []) map.set(line.id, line);
    return map;
  }, [pickLinesQuery.data]);

  const orderLineById = useMemo(() => {
    const map = new Map<string, OrderLine>();
    for (const line of orderLinesQuery.data ?? []) map.set(line.id, line);
    return map;
  }, [orderLinesQuery.data]);

  // Pooled supply by variety, broken down by grower — the PRD's left-hand
  // column.
  const supplyByVariety = useMemo(() => {
    const groups = new Map<
      string,
      { varietyId: string; label: string; total: number; byGrower: Map<string, { name: string; pallets: number }> }
    >();
    for (const line of pickLinesQuery.data ?? []) {
      const variety = varietyById.get(line.product_variety_id);
      const growerId = growerIdByPickId.get(line.daily_pick_id);
      if (!variety || !growerId) continue;
      const pallets = Number(line.pallets_picked);
      const label = variety.product_families?.name ? `${variety.product_families.name} — ${variety.name}` : variety.name;
      let group = groups.get(variety.id);
      if (!group) {
        group = { varietyId: variety.id, label, total: 0, byGrower: new Map() };
        groups.set(variety.id, group);
      }
      group.total += pallets;
      const growerName = companyNameById.get(growerId) ?? growerId;
      const existing = group.byGrower.get(growerId);
      group.byGrower.set(growerId, { name: growerName, pallets: (existing?.pallets ?? 0) + pallets });
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [pickLinesQuery.data, varietyById, growerIdByPickId, companyNameById]);

  // Pooled demand by variety, broken down by customer — the PRD's
  // right-hand column.
  const demandByVariety = useMemo(() => {
    const groups = new Map<
      string,
      { varietyId: string; label: string; total: number; byCustomer: Map<string, { name: string; pallets: number }> }
    >();
    for (const line of orderLinesQuery.data ?? []) {
      const variety = varietyById.get(line.product_variety_id);
      const customerId = customerIdByOrderId.get(line.daily_order_id);
      if (!variety || !customerId) continue;
      const pallets = Number(line.pallets_ordered);
      const label = variety.product_families?.name ? `${variety.product_families.name} — ${variety.name}` : variety.name;
      let group = groups.get(variety.id);
      if (!group) {
        group = { varietyId: variety.id, label, total: 0, byCustomer: new Map() };
        groups.set(variety.id, group);
      }
      group.total += pallets;
      const customerName = companyNameById.get(customerId) ?? customerId;
      const existing = group.byCustomer.get(customerId);
      group.byCustomer.set(customerId, { name: customerName, pallets: (existing?.pallets ?? 0) + pallets });
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [orderLinesQuery.data, varietyById, customerIdByOrderId, companyNameById]);

  // Out-of-stock: total demand exceeds total supply for the variety (PRD's
  // ◯◯◯ OOS indicator).
  const outOfStockVarietyIds = useMemo(() => {
    const supplyTotal = new Map(supplyByVariety.map((group) => [group.varietyId, group.total]));
    const ids = new Set<string>();
    for (const demand of demandByVariety) {
      if (demand.total > (supplyTotal.get(demand.varietyId) ?? 0)) ids.add(demand.varietyId);
    }
    return ids;
  }, [supplyByVariety, demandByVariety]);

  // Arrangement records, resolved to display fields and grouped by the
  // active view mode — same records, same joins, just a different primary
  // sort key (R6: one function, two groupings, not two data models).
  const recordRows = useMemo(() => {
    return (recordsQuery.data ?? [])
      .map((record) => {
        const pickLine = pickLineById.get(record.daily_pick_product_id);
        const orderLine = orderLineById.get(record.daily_order_product_id);
        const variety = pickLine ? varietyById.get(pickLine.product_variety_id) : undefined;
        const growerId = pickLine ? growerIdByPickId.get(pickLine.daily_pick_id) : undefined;
        return {
          record,
          varietyLabel: variety ? (variety.product_families?.name ? `${variety.product_families.name} — ${variety.name}` : variety.name) : "—",
          growerName: growerId ? (companyNameById.get(growerId) ?? growerId) : "—",
          customerName: companyNameById.get(record.customer_company_id) ?? record.customer_company_id,
          pickLine,
          orderLine,
        };
      })
      .sort((a, b) => {
        const primary = viewMode === "by-grower" ? a.growerName.localeCompare(b.growerName) : a.varietyLabel.localeCompare(b.varietyLabel);
        if (primary !== 0) return primary;
        return viewMode === "by-grower" ? a.varietyLabel.localeCompare(b.varietyLabel) : a.growerName.localeCompare(b.growerName);
      });
  }, [recordsQuery.data, pickLineById, orderLineById, varietyById, growerIdByPickId, companyNameById, viewMode]);

  const deleteMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase.rpc("delete_arrangement_record", toDeleteArrangementRecordRpcArgs({ id: recordId }));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("הרשומה נמחקה.", "success");
      void queryClient.invalidateQueries({ queryKey: ["arrangement", "records", arrangement?.id] });
    },
    onError: (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; quantityPallets: number; price: number | null; priceType: string | null }) => {
      const parsed = updateArrangementRecordInputSchema.parse(input);
      const { error } = await supabase.rpc("update_arrangement_record", toUpdateArrangementRecordRpcArgs(parsed));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("הרשומה עודכנה.", "success");
      void queryClient.invalidateQueries({ queryKey: ["arrangement", "records", arrangement?.id] });
    },
    onError: (error: { message?: string }) => {
      showToast(`העדכון נכשל: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_arrangement");
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("הסידור נסגר.", "success");
      void queryClient.invalidateQueries({ queryKey: ["arrangement"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`סגירת הסידור נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const isLoading =
    dayQuery.isLoading || (!!day && (arrangementQuery.isLoading || picksQuery.isLoading || ordersQuery.isLoading));

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!day || !arrangement) {
    return <p className="text-sm text-ink-muted">אין יום מסחר פתוח כרגע.</p>;
  }

  const canClose = day.phase === "shop_closed" && arrangement.status === "open";

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={`סידור — ${new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(day.trade_date))}`}
        subtitle={`שלב יום: ${PHASE_LABEL[day.phase]} · סטטוס סידור: ${arrangement.status === "open" ? "פתוח" : "סגור"}`}
        actions={
          <>
            <Link href="/backoffice/new-arrangement">
              <Button type="button" variant="secondary">
                + סידור חדש
              </Button>
            </Link>
            <Button
              type="button"
              disabled={!canClose || closing}
              onClick={() => {
                setClosing(true);
                closeMutation.mutate(undefined, { onSettled: () => setClosing(false) });
              }}
            >
              {closing ? "סוגר…" : "סגור סידור ←"}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-muted">היצע מאוגד (לפי זן)</h2>
          <div className="flex flex-col gap-3">
            {supplyByVariety.length === 0 && <p className="text-sm text-ink-muted">אין היצע רשום עדיין.</p>}
            {supplyByVariety.map((group) => (
              <div key={group.varietyId} className="border-b border-border pb-2 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {group.label} — {group.total} משטחים
                    {outOfStockVarietyIds.has(group.varietyId) && (
                      <span className="ms-2 text-xs font-semibold text-danger">חוסר במלאי</span>
                    )}
                  </span>
                  <Button type="button" variant="ghost" onClick={() => setPriceEditVarietyId(group.varietyId)}>
                    ערוך מחיר
                  </Button>
                </div>
                <ul className="ms-4 mt-1 text-xs text-ink-muted">
                  {[...group.byGrower.values()].map((g, i) => (
                    <li key={i}>
                      {g.name}: {g.pallets} משטחים
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-muted">ביקוש מאוגד (לפי זן)</h2>
          <div className="flex flex-col gap-3">
            {demandByVariety.length === 0 && <p className="text-sm text-ink-muted">אין ביקוש רשום עדיין.</p>}
            {demandByVariety.map((group) => (
              <div key={group.varietyId} className="border-b border-border pb-2 last:border-0">
                <span className="text-sm font-medium">
                  {group.label} — {group.total} משטחים
                  {outOfStockVarietyIds.has(group.varietyId) && (
                    <span className="ms-2 text-xs font-semibold text-danger">חוסר במלאי</span>
                  )}
                </span>
                <ul className="ms-4 mt-1 text-xs text-ink-muted">
                  {[...group.byCustomer.values()].map((c, i) => (
                    <li key={i}>
                      {c.name}: {c.pallets} משטחים
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-muted">רשומות סידור (התאמת קווים)</h2>
          <div className="flex gap-1 rounded-md border border-border p-1">
            <Button
              type="button"
              variant={viewMode === "by-product" ? "primary" : "ghost"}
              onClick={() => setViewMode("by-product")}
            >
              לפי מוצר
            </Button>
            <Button
              type="button"
              variant={viewMode === "by-grower" ? "primary" : "ghost"}
              onClick={() => setViewMode("by-grower")}
            >
              לפי מגדל
            </Button>
          </div>
        </div>

        <TableContainer>
          <TableHeader>
            <TableRow>
              <TableHead>זן</TableHead>
              <TableHead>מגדל</TableHead>
              <TableHead>לקוח</TableHead>
              <TableHead>כמות</TableHead>
              <TableHead>מחיר</TableHead>
              <TableHead>סוג תמחור</TableHead>
              <TableHead>פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recordRows.map((row) => (
              <ArrangementRecordRow
                key={row.record.id}
                varietyLabel={row.varietyLabel}
                growerName={row.growerName}
                customerName={row.customerName}
                record={row.record}
                editable={arrangement.status === "open"}
                onSave={(patch) => updateMutation.mutate({ id: row.record.id, ...patch })}
                onDelete={() => deleteMutation.mutate(row.record.id)}
                saving={updateMutation.isPending}
              />
            ))}
            {recordRows.length === 0 && (
              <TableRow>
                <TableCell className="text-ink-muted" colSpan={7}>
                  אין רשומות סידור עדיין.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </TableContainer>
      </div>

      <PriceEditDialog varietyId={priceEditVarietyId} onClose={() => setPriceEditVarietyId(null)} />
    </div>
  );
}

const PHASE_LABEL: Record<TradingDay["phase"], string> = {
  initiated: "פתיחת יום",
  shop_open: "חנות פתוחה",
  shop_closed: "חנות סגורה",
  closed: "סגור",
};

function ArrangementRecordRow({
  varietyLabel,
  growerName,
  customerName,
  record,
  editable,
  saving,
  onSave,
  onDelete,
}: {
  varietyLabel: string;
  growerName: string;
  customerName: string;
  record: ArrangementRecord;
  editable: boolean;
  saving: boolean;
  onSave: (patch: { quantityPallets: number; price: number | null; priceType: string | null }) => void;
  onDelete: () => void;
}) {
  const [quantity, setQuantity] = useState(String(record.quantity_pallets));
  const [price, setPrice] = useState(record.price === null ? "" : String(record.price));
  const [priceType, setPriceType] = useState(record.price_type ?? "");

  return (
    <TableRow>
      <TableCell>{varietyLabel}</TableCell>
      <TableCell>{growerName}</TableCell>
      <TableCell>{customerName}</TableCell>
      <TableCell>
        <input
          type="number"
          step="0.01"
          min={0}
          disabled={!editable}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm disabled:bg-canvas"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <input
          type="number"
          step="0.01"
          min={0}
          disabled={!editable}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm disabled:bg-canvas"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <input
          disabled={!editable}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm disabled:bg-canvas"
          value={priceType}
          onChange={(event) => setPriceType(event.target.value)}
        />
      </TableCell>
      <TableCell>
        {editable && (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() =>
                onSave({
                  quantityPallets: Number(quantity),
                  price: price === "" ? null : Number(price),
                  priceType: priceType || null,
                })
              }
            >
              שמור
            </Button>
            <Button type="button" variant="danger" disabled={saving} onClick={onDelete}>
              מחק
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
