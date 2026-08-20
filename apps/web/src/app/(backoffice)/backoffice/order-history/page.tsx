"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
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

function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

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
        <Skeleton className="h-10 w-full" />
      ) : !dayId ? (
        <p className="text-sm text-ink-muted">אין יום מסחר בתאריך זה.</p>
      ) : (
        <ListDetailLayout
          list={
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface shadow-card">
              {ordersQuery.isLoading ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : sortedOrders.length === 0 ? (
                <p className="p-4 text-sm text-ink-muted">אין הזמנות ליום זה.</p>
              ) : (
                <ul>
                  {sortedOrders.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedOrderId(row.id)}
                        className={`flex w-full items-center justify-between relative border-b border-border px-4 py-2.5 text-start text-sm transition-colors ${
                          row.id === selectedOrderId
                            ? "bg-accent-soft font-semibold text-accent before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-accent"
                            : "hover:bg-canvas"
                        }`}
                      >
                        <span>{row.companies?.name ?? "—"}</span>
                        <span className="text-xs text-ink-muted">{STATUS_LABEL[row.status]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          }
          detail={
            !selected ? (
              <p className="text-sm text-ink-muted">בחר הזמנה מהרשימה.</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <h1 className="text-lg font-semibold">{selected.companies?.name ?? "—"}</h1>
                  <p className="text-sm text-ink-muted">
                    סטטוס: {STATUS_LABEL[selected.status]}
                    {selected.submitted_at &&
                      ` · נשלח ב-${new Date(selected.submitted_at).toLocaleString("he-IL")}`}
                  </p>
                </div>

                {linesQuery.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : !linesQuery.data || linesQuery.data.length === 0 ? (
                  <p className="text-sm text-ink-muted">אין שורות בהזמנה זו.</p>
                ) : (
                  <TableContainer>
                    <TableHeader>
                      <TableRow>
                        <TableHead>מוצר</TableHead>
                        <TableHead>הוזמן</TableHead>
                        <TableHead>סודר</TableHead>
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
                              {line.product_varieties?.product_families?.name
                                ? `${line.product_varieties.product_families.name} — ${line.product_varieties.name}`
                                : (line.product_varieties?.name ?? "")}
                            </TableCell>
                            <TableCell>{line.pallets_ordered}</TableCell>
                            <TableCell className={mismatch ? "font-medium text-danger" : ""}>
                              {arranged}
                            </TableCell>
                            <TableCell>{line.comment ?? ""}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </TableContainer>
                )}
              </div>
            )
          }
        />
      )}
    </div>
  );
}
