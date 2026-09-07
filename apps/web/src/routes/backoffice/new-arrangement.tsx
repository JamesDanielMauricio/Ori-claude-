import { createArrangementRecordInputSchema, toCreateArrangementRecordRpcArgs } from "@ori/domain/arrangement";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { FormField, inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Card, FormSection } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

// One nested row carrying the whole wizard's data — see BOARD comment in
// the query below.
interface TradingDay {
  id: string;
  trade_date: string;
  // one-to-one embed (unique trading_day_id), so an object not an array
  daily_arrangements: DailyArrangement | null;
  daily_picks: PickHeader[];
  daily_orders: OrderHeader[];
}

interface DailyArrangement {
  id: string;
  status: "open" | "closed";
  arrangement_records: ExistingArrangementRecord[];
}

interface PickHeader {
  id: string;
  grower_company_id: string;
  daily_pick_products: PickLine[];
}

interface PickLine {
  id: string;
  daily_pick_id: string;
  product_variety_id: string;
  pallets_picked: string;
  product_varieties: Variety | null;
}

interface OrderHeader {
  id: string;
  customer_company_id: string;
  daily_order_products: OrderLine[];
}

interface OrderLine {
  id: string;
  daily_order_id: string;
  product_variety_id: string;
  pallets_ordered: string;
  product_varieties: Variety | null;
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

  // Same single-request shape as /backoffice/arrangement — see the long
  // comment on that page's boardQuery for why the whole tree comes back in
  // one round trip instead of a 3-deep chain of dependent queries.
  const boardQuery = useQuery({
    queryKey: ["new-arrangement", "board"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select(
          `id, trade_date,
           daily_arrangements(id, status, arrangement_records(daily_pick_product_id, daily_order_product_id, quantity_pallets)),
           daily_picks(id, grower_company_id, daily_pick_products(id, daily_pick_id, product_variety_id, pallets_picked, product_varieties(id, name, price, price_type, product_families(name)))),
           daily_orders(id, customer_company_id, daily_order_products(id, daily_order_id, product_variety_id, pallets_ordered, product_varieties(id, name, price, price_type, product_families(name))))`,
        )
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TradingDay | null;
    },
  });

  const day = boardQuery.data ?? null;
  const arrangement = day?.daily_arrangements ?? null;
  const records = useMemo(() => arrangement?.arrangement_records ?? [], [arrangement]);
  const picks = useMemo(() => day?.daily_picks ?? [], [day]);
  const orders = useMemo(() => day?.daily_orders ?? [], [day]);
  const pickLines = useMemo(() => picks.flatMap((pick) => pick.daily_pick_products), [picks]);
  const orderLines = useMemo(() => orders.flatMap((order) => order.daily_order_products), [orders]);

  // De-duplicated from the lines that already carry them, rather than a
  // dependent request of their own.
  const varieties = useMemo(() => {
    const map = new Map<string, Variety>();
    for (const line of pickLines) if (line.product_varieties) map.set(line.product_varieties.id, line.product_varieties);
    for (const line of orderLines) if (line.product_varieties) map.set(line.product_varieties.id, line.product_varieties);
    return [...map.values()];
  }, [pickLines, orderLines]);

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
    for (const pick of picks) map.set(pick.id, pick.grower_company_id);
    return map;
  }, [picks]);

  const customerIdByOrderId = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of orders) map.set(order.id, order.customer_company_id);
    return map;
  }, [orders]);

  // Already-arranged pallets per pick/order line — used only to show a
  // "remaining" hint; the server (check_arrangement_allocation) is the
  // real enforcement.
  const arrangedByPickLine = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of records) {
      map.set(record.daily_pick_product_id, (map.get(record.daily_pick_product_id) ?? 0) + record.quantity_pallets);
    }
    return map;
  }, [records]);

  const arrangedByOrderLine = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of records) {
      map.set(record.daily_order_product_id, (map.get(record.daily_order_product_id) ?? 0) + record.quantity_pallets);
    }
    return map;
  }, [records]);

  const varietyOptions = useMemo(() => {
    return varieties
      .map((variety) => ({
        id: variety.id,
        label: variety.product_families?.name ? `${variety.product_families.name} — ${variety.name}` : variety.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [varieties]);

  const growerLineOptions = useMemo(() => {
    if (!varietyId) return [];
    return pickLines
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
  }, [varietyId, pickLines, growerIdByPickId, arrangedByPickLine, companyNameById]);

  const customerLineOptions = useMemo(() => {
    if (!varietyId) return [];
    return orderLines
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
  }, [varietyId, orderLines, customerIdByOrderId, arrangedByOrderLine, companyNameById]);

  const selectedVariety = varieties.find((variety) => variety.id === varietyId) ?? null;

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
      // Both this wizard's board and the sibling /backoffice/arrangement
      // page's cache — the new record has to show up in each.
      void queryClient.invalidateQueries({ queryKey: ["new-arrangement", "board"] });
      void queryClient.invalidateQueries({ queryKey: ["arrangement"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`יצירת הרשומה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const isLoading = boardQuery.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!day || !arrangement) {
    return (
      <div className="max-w-xl rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="clock"
          title="אין יום מסחר פתוח"
          hint="פתח יום עסקים בסרגל הצד כדי להתחיל לסדר ליקוטים מול הזמנות."
        />
      </div>
    );
  }

  if (arrangement.status !== "open") {
    return (
      <div className="max-w-xl rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="clipboard"
          title="הסידור להיום כבר נסגר"
          hint="לא ניתן להוסיף רשומות סידור אחרי סגירת הסידור."
          action={
            <Link
              to="/backoffice/arrangement"
              className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-ink shadow-accent transition-colors duration-200 hover:bg-accent-hover"
            >
              לסידור המלא
            </Link>
          }
        />
      </div>
    );
  }

  const canSave = !!growerPickLineId && !!customerOrderLineId && Number(quantity) > 0;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader
        title="סידור חדש"
        subtitle={`התאם קו ליקוט של מגדל לקו הזמנה של לקוח, ליום ${new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(day.trade_date))}.`}
        actions={
          <Link
            to="/backoffice/arrangement"
            className="inline-flex h-10 items-center justify-center rounded-md bg-surface px-5 text-sm font-semibold text-ink shadow-card ring-1 ring-inset ring-border-strong transition-colors duration-200 hover:bg-surface-muted hover:text-accent hover:ring-accent/40"
          >
            לסידור המלא
          </Link>
        }
      />

      {/* Split into "what is being matched" and "on what terms". The form was
          a flat run of six controls where the two halves — the three-step
          variety→grower→customer match, and its commercial terms — carry
          completely different questions. */}
      <Card padded={false}>
        <div className="flex flex-col gap-6 p-6">
          <FormSection
            title="התאמה"
            hint="בחר זן תחילה — רשימות המגדל והלקוח מסוננות לפיו."
          >
            <FormField label="זן" htmlFor="new-arr-variety">
              <select
                id="new-arr-variety"
                className={`${inputClassName} w-full`}
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
                className={`${inputClassName} w-full`}
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
                className={`${inputClassName} w-full`}
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
          </FormSection>

          <FormSection title="כמות ותמחור" columns={2}>
            <FormField label="כמות (משטחים)" htmlFor="new-arr-quantity">
              <input
                id="new-arr-quantity"
                type="number"
                step="0.01"
                min={0}
                className={`${inputClassName} w-full`}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </FormField>
            <div className="hidden sm:block" />
            <FormField label="מחיר" htmlFor="new-arr-price">
              <input
                id="new-arr-price"
                type="number"
                step="0.01"
                className={`${inputClassName} w-full`}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </FormField>
            <FormField label="סוג תמחור" htmlFor="new-arr-price-type">
              <input
                id="new-arr-price-type"
                className={`${inputClassName} w-full`}
                value={priceType}
                onChange={(event) => setPriceType(event.target.value)}
              />
            </FormField>
          </FormSection>
        </div>

        {/* The submit sits on its own tinted footer rather than floating as
            the last item in the field stack, so "the form ends here" is a
            visible edge and not just more whitespace. */}
        <div className="flex items-center justify-end gap-3 border-t border-border bg-surface-muted/60 px-6 py-4">
          {!canSave && (
            <p className="text-xs text-ink-muted">בחר מגדל, לקוח וכמות גדולה מאפס.</p>
          )}
          <Button
            type="button"
            disabled={!canSave || saving}
            onClick={() => {
              setSaving(true);
              createMutation.mutate(undefined, { onSettled: () => setSaving(false) });
            }}
          >
            {saving && (
              <span
                aria-hidden
                className="animate-spin-loop h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {saving ? "שומר…" : "צור רשומת סידור"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
