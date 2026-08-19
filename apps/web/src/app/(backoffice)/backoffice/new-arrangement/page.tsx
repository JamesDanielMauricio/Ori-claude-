"use client";

import { createArrangementRecordInputSchema, toCreateArrangementRecordRpcArgs } from "@ori/domain/arrangement";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface TradingDay {
  id: string;
  trade_date: string;
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
  price: number | null;
  price_type: string | null;
  product_families: { name: string } | null;
}

interface Company {
  id: string;
  name: string;
}

interface ExistingArrangementRecord {
  daily_pick_product_id: string;
  daily_order_product_id: string;
  quantity_pallets: number;
}

// The focused "New Arrangement" wizard (PRD: new-arrangement-wizard.md) —
// one record at a time: variety, then the grower pick line supplying it,
// then the customer order line receiving it, then quantity and price.
// Deliberately a separate route from /backoffice/arrangement (the PRD
// itself treats them as two screens, tab=arrangement vs
// tab=new+arrangement) even though both read the same underlying
// supply/demand/records data — this one is optimized for fast, repeated
// single-record entry, not for reviewing/editing the whole day at once.
// Over-allocation on either side is enforced server-side by
// create_arrangement_record (P0009) — the "remaining" figures shown here
// are a courtesy, not the actual guard.
export default function NewArrangementPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [varietyId, setVarietyId] = useState("");
  const [growerPickLineId, setGrowerPickLineId] = useState("");
  const [customerOrderLineId, setCustomerOrderLineId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [priceType, setPriceType] = useState("");
  const [saving, setSaving] = useState(false);

  const dayQuery = useQuery({
    queryKey: ["new-arrangement", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trading_days").select("id, trade_date").neq("phase", "closed").maybeSingle();
      if (error) throw error;
      return data as TradingDay | null;
    },
  });
  const day = dayQuery.data;

  const arrangementQuery = useQuery({
    queryKey: ["new-arrangement", "daily-arrangement", day?.id],
    enabled: !!day,
    queryFn: async () => {
      const { data, error } = await supabase.from("daily_arrangements").select("id, status").eq("trading_day_id", day!.id).single();
      if (error) throw error;
      return data as DailyArrangement;
    },
  });
  const arrangement = arrangementQuery.data;

  const picksQuery = useQuery({
    queryKey: ["new-arrangement", "picks", day?.id],
    enabled: !!day,
    queryFn: async () => {
      const { data, error } = await supabase.from("daily_picks").select("id, grower_company_id").eq("trading_day_id", day!.id);
      if (error) throw error;
      return data as PickHeader[];
    },
  });

  const pickLinesQuery = useQuery({
    queryKey: ["new-arrangement", "pick-lines", day?.id],
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
    queryKey: ["new-arrangement", "orders", day?.id],
    enabled: !!day,
    queryFn: async () => {
      const { data, error } = await supabase.from("daily_orders").select("id, customer_company_id").eq("trading_day_id", day!.id);
      if (error) throw error;
      return data as OrderHeader[];
    },
  });

  const orderLinesQuery = useQuery({
    queryKey: ["new-arrangement", "order-lines", day?.id],
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
    queryKey: ["new-arrangement", "records", arrangement?.id],
    enabled: !!arrangement,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arrangement_records")
        .select("daily_pick_product_id, daily_order_product_id, quantity_pallets")
        .eq("daily_arrangement_id", arrangement!.id);
      if (error) throw error;
      return data as unknown as ExistingArrangementRecord[];
    },
  });

  const varietyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of pickLinesQuery.data ?? []) ids.add(line.product_variety_id);
    for (const line of orderLinesQuery.data ?? []) ids.add(line.product_variety_id);
    return [...ids];
  }, [pickLinesQuery.data, orderLinesQuery.data]);

  const varietiesQuery = useQuery({
    queryKey: ["new-arrangement", "varieties", varietyIds],
    enabled: varietyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select("id, name, price, price_type, product_families(name)")
        .in("id", varietyIds);
      if (error) throw error;
      return data as unknown as Variety[];
    },
  });

  const companiesQuery = useQuery({
    queryKey: ["new-arrangement", "companies"],
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

  // Already-arranged pallets per pick/order line — used only to show a
  // "remaining" hint; the server (check_arrangement_allocation) is the
  // real enforcement.
  const arrangedByPickLine = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of recordsQuery.data ?? []) {
      map.set(record.daily_pick_product_id, (map.get(record.daily_pick_product_id) ?? 0) + record.quantity_pallets);
    }
    return map;
  }, [recordsQuery.data]);

  const arrangedByOrderLine = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of recordsQuery.data ?? []) {
      map.set(record.daily_order_product_id, (map.get(record.daily_order_product_id) ?? 0) + record.quantity_pallets);
    }
    return map;
  }, [recordsQuery.data]);

  const varietyOptions = useMemo(() => {
    return (varietiesQuery.data ?? [])
      .map((variety) => ({
        id: variety.id,
        label: variety.product_families?.name ? `${variety.product_families.name} — ${variety.name}` : variety.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [varietiesQuery.data]);

  const growerLineOptions = useMemo(() => {
    if (!varietyId) return [];
    return (pickLinesQuery.data ?? [])
      .filter((line) => line.product_variety_id === varietyId)
      .map((line) => {
        const growerId = growerIdByPickId.get(line.daily_pick_id);
        const picked = Number(line.pallets_picked);
        const arranged = arrangedByPickLine.get(line.id) ?? 0;
        return {
          id: line.id,
          label: `${growerId ? (companyNameById.get(growerId) ?? growerId) : "—"} — ${picked - arranged} נותרו מתוך ${picked}`,
          remaining: picked - arranged,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [varietyId, pickLinesQuery.data, growerIdByPickId, arrangedByPickLine, companyNameById]);

  const customerLineOptions = useMemo(() => {
    if (!varietyId) return [];
    return (orderLinesQuery.data ?? [])
      .filter((line) => line.product_variety_id === varietyId)
      .map((line) => {
        const customerId = customerIdByOrderId.get(line.daily_order_id);
        const ordered = Number(line.pallets_ordered);
        const arranged = arrangedByOrderLine.get(line.id) ?? 0;
        return {
          id: line.id,
          label: `${customerId ? (companyNameById.get(customerId) ?? customerId) : "—"} — ${ordered - arranged} נותרו מתוך ${ordered}`,
          remaining: ordered - arranged,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [varietyId, orderLinesQuery.data, customerIdByOrderId, arrangedByOrderLine, companyNameById]);

  const selectedVariety = varietiesQuery.data?.find((variety) => variety.id === varietyId) ?? null;

  // Reset the grower/customer/quantity selection whenever the variety
  // changes — a pick/order line from a different variety is meaningless
  // here, and re-prefill price from the newly selected variety's own
  // configured price.
  useEffect(() => {
    setGrowerPickLineId("");
    setCustomerOrderLineId("");
    setQuantity("");
    setPrice(selectedVariety?.price != null ? String(selectedVariety.price) : "");
    setPriceType(selectedVariety?.price_type ?? "");
  }, [varietyId, selectedVariety]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const input = createArrangementRecordInputSchema.parse({
        dailyPickProductId: growerPickLineId,
        dailyOrderProductId: customerOrderLineId,
        quantityPallets: Number(quantity),
        price: price === "" ? null : Number(price),
        priceType: priceType || null,
      });
      const { error } = await supabase.rpc("create_arrangement_record", toCreateArrangementRecordRpcArgs(input));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("הרשומה נוצרה.", "success");
      setGrowerPickLineId("");
      setCustomerOrderLineId("");
      setQuantity("");
      void queryClient.invalidateQueries({ queryKey: ["new-arrangement", "records", arrangement?.id] });
      void queryClient.invalidateQueries({ queryKey: ["arrangement"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`יצירת הרשומה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const isLoading = dayQuery.isLoading || (!!day && (arrangementQuery.isLoading || picksQuery.isLoading || ordersQuery.isLoading));

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!day || !arrangement) {
    return <p className="text-sm text-ink-muted">אין יום מסחר פתוח כרגע.</p>;
  }

  if (arrangement.status !== "open") {
    return <p className="text-sm text-ink-muted">הסידור להיום כבר נסגר.</p>;
  }

  const canSave = !!growerPickLineId && !!customerOrderLineId && Number(quantity) > 0;

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          סידור חדש — {new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(day.trade_date))}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          התאם קו ליקוט של מגדל לקו הזמנה של לקוח.{" "}
          <Link href="/backoffice/arrangement" className="text-accent underline">
            חזרה לסידור המלא
          </Link>
        </p>
      </div>

      <FormField label="זן" htmlFor="new-arr-variety">
        <select
          id="new-arr-variety"
          className={inputClassName}
          value={varietyId}
          onChange={(event) => setVarietyId(event.target.value)}
        >
          <option value="">בחר זן…</option>
          {varietyOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="מגדל (קו ליקוט)" htmlFor="new-arr-grower">
        <select
          id="new-arr-grower"
          className={inputClassName}
          disabled={!varietyId}
          value={growerPickLineId}
          onChange={(event) => setGrowerPickLineId(event.target.value)}
        >
          <option value="">בחר מגדל…</option>
          {growerLineOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="לקוח (קו הזמנה)" htmlFor="new-arr-customer">
        <select
          id="new-arr-customer"
          className={inputClassName}
          disabled={!varietyId}
          value={customerOrderLineId}
          onChange={(event) => setCustomerOrderLineId(event.target.value)}
        >
          <option value="">בחר לקוח…</option>
          {customerLineOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="כמות (משטחים)" htmlFor="new-arr-quantity">
        <input
          id="new-arr-quantity"
          type="number"
          step="0.01"
          min={0}
          className={inputClassName}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="מחיר" htmlFor="new-arr-price">
          <input
            id="new-arr-price"
            type="number"
            step="0.01"
            className={inputClassName}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </FormField>
        <FormField label="סוג תמחור" htmlFor="new-arr-price-type">
          <input
            id="new-arr-price-type"
            className={inputClassName}
            value={priceType}
            onChange={(event) => setPriceType(event.target.value)}
          />
        </FormField>
      </div>

      <Button
        type="button"
        disabled={!canSave || saving}
        onClick={() => {
          setSaving(true);
          createMutation.mutate(undefined, { onSettled: () => setSaving(false) });
        }}
      >
        {saving ? "שומר…" : "צור רשומת סידור"}
      </Button>
    </div>
  );
}
