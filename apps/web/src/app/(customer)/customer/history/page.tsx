"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";

interface OrderRow {
  id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  trading_days: { trade_date: string } | null;
}

interface OrderLineRow {
  id: string;
  // Confirmed empirically (not the `string` convention used elsewhere for
  // a plain `.select()` on a numeric column — e.g. products/page.tsx's
  // price/no_overbooking): PostgREST returns this numeric(10,2) column as
  // a bare JSON number, not a decimal-preserving string.
  pallets_ordered: number;
  comment: string | null;
  product_varieties: { name: string; product_families: { name: string } | null } | null;
}

const STATUS_LABEL: Record<OrderRow["status"], string> = {
  open: "טיוטה",
  submitted: "נשלחה",
};

// Read-only order history (PRD: customer-home/order-history.md) — every
// past Daily Order for this customer's company, newest first. Cross-company
// isolation is enforced by RLS (daily_orders_select_own), not a
// client-side filter.
export default function CustomerOrderHistoryPage() {
  const supabase = createClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ["customer", "order-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_orders")
        .select("id, status, submitted_at, trading_days(trade_date)");
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
  });

  const sortedOrders = useMemo(() => {
    return [...(ordersQuery.data ?? [])].sort((a, b) => {
      const dateA = a.trading_days?.trade_date ?? "";
      const dateB = b.trading_days?.trade_date ?? "";
      return dateB.localeCompare(dateA);
    });
  }, [ordersQuery.data]);

  const selected = sortedOrders.find((row) => row.id === selectedId) ?? null;

  const linesQuery = useQuery({
    queryKey: ["customer", "order-history-lines", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_order_products")
        .select("id, pallets_ordered, comment, product_varieties(name, product_families(name))")
        .eq("daily_order_id", selectedId!)
        .order("product_variety_id");
      if (error) throw error;
      // supabase-types.ts declares pallets_ordered as `string`, matching
      // the convention used elsewhere in this codebase for a plain
      // `.select()` on a numeric column (e.g. products/page.tsx's
      // price/no_overbooking) — but confirmed empirically (a raw
      // PostgREST query) that this column actually comes back as a bare
      // JSON number, not a decimal-preserving string. Not fixing the
      // shared type declaration here, since that convention is used
      // (apparently harmlessly so far) in a couple of other places this
      // change wasn't scoped to touch — `as unknown as` documents the
      // known mismatch rather than silently going along with the wrong
      // declared type via a same-shape `as` cast.
      return data as unknown as OrderLineRow[];
    },
  });

  return (
    <ListDetailLayout
      header={<PageHeader title="היסטוריית הזמנות" subtitle="הזמנות מימי מסחר קודמים, מהחדשה לישנה." />}
      list={
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface">
          {ordersQuery.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : sortedOrders.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">אין עדיין הזמנות.</p>
          ) : (
            <ul>
              {sortedOrders.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={`flex w-full items-center justify-between border-b border-border px-4 py-3 text-start text-sm hover:bg-canvas ${
                      row.id === selectedId ? "bg-canvas font-medium" : ""
                    }`}
                  >
                    <span>
                      {row.trading_days
                        ? new Intl.DateTimeFormat("he-IL", { dateStyle: "medium" }).format(
                            new Date(row.trading_days.trade_date),
                          )
                        : "—"}
                    </span>
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
              <h1 className="text-lg font-semibold">
                {selected.trading_days
                  ? new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(
                      new Date(selected.trading_days.trade_date),
                    )
                  : "—"}
              </h1>
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
                    <TableHead>פלטות</TableHead>
                    <TableHead>הערה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linesQuery.data.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        {line.product_varieties?.product_families?.name
                          ? `${line.product_varieties.product_families.name} — ${line.product_varieties.name}`
                          : (line.product_varieties?.name ?? "")}
                      </TableCell>
                      <TableCell>{line.pallets_ordered}</TableCell>
                      <TableCell>{line.comment ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </TableContainer>
            )}
          </div>
        )
      }
    />
  );
}
