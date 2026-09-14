import { todayIsoDate } from "@ori/shared/dates";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { RecordList } from "@/components/reference-data/record-list";
import { StatusPill } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";

interface OrderRow {
  id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  companies: { name: string } | null;
}

interface OrderLineRow {
  id: string;
  pallets_ordered: number;
  comment: string | null;
  product_varieties: { name: string; product_families: { name: string } | null } | null;
  arrangement_records: Array<{ quantity_pallets: number; price: number | null }>;
}

const STATUS_LABEL: Record<OrderRow["status"], string> = {
  open: "פתוח",
  submitted: "נשלח",
};

// Arrangement and Orders History by Date (PRD:
// backoffice/order-history-distributor-view.md — "arranged history" tab):
// pick a date, see every customer's order for that date and, per line,
// what was actually arranged against it — for dispute resolution.
// Backoffice-only, read-only: no writes anywhere on this screen.
// Privileged cross-company read backed by the Order Visibility rule — RLS
// (daily_orders_select_backoffice, arrangement_records_select_backoffice)
// is what actually enforces that, not a client-side filter.
export default function ArrangedOrderHistoryPage() {
  const supabase = createClient();
  const [date, setDate] = useState(todayIsoDate());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const dayQuery = useQuery({
    queryKey: ["order-history", "trading-day", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date")
        .eq("trade_date", date)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; trade_date: string } | null;
    },
  });
  const dayId = dayQuery.data?.id;

  const ordersQuery = useQuery({
    queryKey: ["order-history", "orders", dayId],
    enabled: !!dayId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_orders")
        .select("id, status, submitted_at, companies(name)")
        .eq("trading_day_id", dayId!);
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
  });

  const sortedOrders = useMemo(() => {
    return [...(ordersQuery.data ?? [])].sort((a, b) =>
      (a.companies?.name ?? "").localeCompare(b.companies?.name ?? "", "he"),
    );
  }, [ordersQuery.data]);

  const selected = sortedOrders.find((row) => row.id === selectedOrderId) ?? null;

  const linesQuery = useQuery({
    queryKey: ["order-history", "lines", selectedOrderId],
    enabled: !!selectedOrderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_order_products")
        .select(
          "id, pallets_ordered, comment, product_varieties(name, product_families(name)), arrangement_records(quantity_pallets, price)",
        )
        .eq("daily_order_id", selectedOrderId!)
        .order("product_variety_id");
      if (error) throw error;
      return data as unknown as OrderLineRow[];
    },
  });

  function arrangedTotal(line: OrderLineRow): number {
    return line.arrangement_records.reduce((sum, record) => sum + record.quantity_pallets, 0);
  }

  const listItems = useMemo(
    () =>
      sortedOrders.map((row) => ({
        id: row.id,
        label: row.companies?.name ?? "—",
        badge: STATUS_LABEL[row.status],
      })),
    [sortedOrders],
  );

  // How many lines were arranged in a quantity other than the one ordered —
  // the number this whole screen exists to surface.
  const mismatchCount = useMemo(
    () =>
      (linesQuery.data ?? []).filter((line) => arrangedTotal(line) !== line.pallets_ordered).length,
    [linesQuery.data],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        title="היסטוריית הזמנות"
        subtitle="מה הוזמן מול מה סודר בפועל, לכל יום מסחר — לבירור מחלוקות. קריאה בלבד."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="historyDate" className="text-sm font-medium text-ink-muted">
              תאריך
            </label>
            <input
              id="historyDate"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setSelectedOrderId(null);
              }}
              className={inputClassName}
            />
          </div>
        }
      />

      {dayQuery.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : !dayId ? (
        <div className="rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
          <EmptyState
            icon="calendar"
            title="אין יום מסחר בתאריך זה"
            hint="בחר תאריך אחר בבורר שלמעלה כדי לראות את ההזמנות שנרשמו בו."
          />
        </div>
      ) : (
        <ListDetailLayout
          list={
            <RecordList
              icon="briefcase"
              items={listItems}
              selectedId={selectedOrderId}
              onSelect={setSelectedOrderId}
              loading={ordersQuery.isLoading}
              searchPlaceholder="חיפוש לקוח"
              emptyLabel="אין הזמנות ליום זה."
            />
          }
          detail={
            !selected ? (
              <EmptyState
                icon="clipboard"
                title="לא נבחרה הזמנה"
                hint="בחר לקוח מהרשימה כדי להשוות שורה מול שורה מה הוזמן ומה סודר בפועל."
              />
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-ink">
                      {selected.companies?.name ?? "—"}
                    </h2>
                    {selected.submitted_at && (
                      <p className="mt-1 text-sm text-ink-muted">
                        נשלח ב-{new Date(selected.submitted_at).toLocaleString("he-IL")}
                      </p>
                    )}
                  </div>
                  <StatusPill tone={selected.status === "submitted" ? "accent" : "warning"} dot>
                    {STATUS_LABEL[selected.status]}
                  </StatusPill>
                </div>

                {linesQuery.isLoading ? (
                  <Skeleton className="h-40 w-full rounded-xl" />
                ) : !linesQuery.data || linesQuery.data.length === 0 ? (
                  <EmptyState icon="package" title="אין שורות בהזמנה זו" />
                ) : (
                  <>
                    {/* A count of the disputed lines above the table. On a
                        screen whose entire purpose is finding where ordered
                        and arranged disagree, that number is the answer — it
                        should not require scanning every row to obtain. */}
                    {mismatchCount > 0 && (
                      <div className="flex items-center gap-2.5 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/20">
                        <Icon name="alertCircle" className="h-4 w-4 shrink-0" />
                        <span>
                          {mismatchCount === 1
                            ? "שורה אחת סודרה בכמות שונה מזו שהוזמנה."
                            : `${mismatchCount} שורות סודרו בכמות שונה מזו שהוזמנה.`}
                        </span>
                      </div>
                    )}

                    <TableContainer>
                      <TableHeader>
                        <TableRow>
                          <TableHead>מוצר</TableHead>
                          <TableHead className="text-end">הוזמן</TableHead>
                          <TableHead className="text-end">סודר</TableHead>
                          <TableHead>הערה</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linesQuery.data.map((line) => {
                          const arranged = arrangedTotal(line);
                          const mismatch = arranged !== line.pallets_ordered;
                          return (
                            <TableRow key={line.id}>
                              <TableCell>
                                <span className="block font-medium text-ink">
                                  {line.product_varieties?.name ?? ""}
                                </span>
                                {line.product_varieties?.product_families?.name && (
                                  <span className="mt-0.5 block text-xs text-ink-muted">
                                    {line.product_varieties.product_families.name}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {line.pallets_ordered}
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                {mismatch ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-md bg-danger-soft px-2 py-0.5 font-semibold text-danger">
                                    {arranged}
                                  </span>
                                ) : (
                                  arranged
                                )}
                              </TableCell>
                              <TableCell className="text-ink-muted">{line.comment ?? ""}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </TableContainer>
                  </>
                )}
              </div>
            )
          }
        />
      )}
    </div>
  );
}
