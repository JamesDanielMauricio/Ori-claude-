import { sendOrderReminderInputSchema, toSendOrderReminderRpcArgs } from "@ori/domain/customer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { OrderLinesEditor } from "@/components/customer/order-lines-editor";
import { ListDetailLayout } from "@/components/reference-data/list-detail-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface CustomerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
}

interface DailyOrderForDay {
  id: string;
  customer_company_id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  reminder_sent_at: string | null;
}

const STATUS_LABEL: Record<DailyOrderForDay["status"], string> = {
  open: "פתוח",
  submitted: "נשלח",
};

// Distributor-facing "Customer Order Status" oversight (PRD:
// backoffice.md's "distributor+customer" tab — "Distributor as Customer
// View": a shared view used when the Distributor needs to act on a
// customer's behalf, no dedicated PRD doc beyond that one-line
// description — same situation the Grower Inventory Status screen was in,
// see distributor-grower/page.tsx). Reuses the exact same OrderLinesEditor
// the customer's own order screen uses — get_orderable_catalog_for_customer
// and submit_order both accept "the owning customer, or backoffice" (see
// packages/db/migrations/0028) — so editing an order here is not a
// special case, just the same component under a backoffice session.
//
// The performance requirement Prompt 10 couldn't verify because this
// screen didn't exist yet (Performance Issues spec, Issue 3 — located at
// tab=distributor+customer): expanding a customer already viewed in this
// session must not fire a fresh query. Selecting a customer keys
// OrderLinesEditor's catalog query off (tradingDayId, customerCompanyId)
// — the same React Query cache + staleTime the customer's own screen
// already proved this out with (docs/PERFORMANCE_VERIFICATION.md) — so
// re-selecting a previously viewed customer reuses the cached result with
// zero new requests. See e2e/distributor-customer.spec.ts for the assertion.
export default function DistributorAsCustomerPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const openDayQuery = useQuery({
    queryKey: ["customer-oversight", "open-trading-day"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select("id, trade_date")
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; trade_date: string } | null;
    },
  });
  const openDayId = openDayQuery.data?.id;

  const customersQuery = useQuery({
    queryKey: ["customer-oversight", "customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status")
        .eq("type", "customer")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as CustomerCompany[];
    },
  });

  const ordersForDayQuery = useQuery({
    queryKey: ["customer-oversight", "orders-for-day", openDayId],
    enabled: !!openDayId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_orders")
        .select("id, customer_company_id, status, submitted_at, reminder_sent_at")
        .eq("trading_day_id", openDayId!);
      if (error) throw error;
      return data as DailyOrderForDay[];
    },
  });

  const orderByCustomerId = useMemo(() => {
    const map = new Map<string, DailyOrderForDay>();
    for (const order of ordersForDayQuery.data ?? []) map.set(order.customer_company_id, order);
    return map;
  }, [ordersForDayQuery.data]);

  const selected = customersQuery.data?.find((row) => row.id === selectedId) ?? null;
  const selectedOrder = selectedId ? (orderByCustomerId.get(selectedId) ?? null) : null;

  const reminderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("no order to remind about");
      const input = sendOrderReminderInputSchema.parse({ dailyOrderId: selectedOrder.id });
      const { error } = await supabase.rpc(
        "send_order_reminder",
        toSendOrderReminderRpcArgs(input),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("התזכורת נשלחה.", "success");
      void queryClient.invalidateQueries({
        queryKey: ["customer-oversight", "orders-for-day", openDayId],
      });
    },
    onError: (error: { message?: string }) => {
      showToast(`שליחת התזכורת נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  return (
    <ListDetailLayout
      header={
        <PageHeader
          title="בשם לקוח"
          subtitle="צפייה ועריכה של הזמנות היום בשם כל לקוח, ושליחת תזכורות."
        />
      }
      list={
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface shadow-card">
          {customersQuery.isLoading || (openDayId && ordersForDayQuery.isLoading) ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <ul>
              {customersQuery.data?.map((row) => {
                const order = orderByCustomerId.get(row.id);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={`flex w-full items-center justify-between relative border-b border-border px-4 py-2.5 text-start text-sm transition-colors ${
                        row.id === selectedId
                          ? "bg-accent-soft font-semibold text-accent before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-accent"
                          : "hover:bg-canvas"
                      }`}
                    >
                      <span>{row.name}</span>
                      <span className="text-xs text-ink-muted">
                        {order ? STATUS_LABEL[order.status] : "אין הזמנה"}
                      </span>
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
          <p className="text-sm text-ink-muted">בחר לקוח מהרשימה.</p>
        ) : !openDayId ? (
          <p className="text-sm text-ink-muted">אין יום מסחר פתוח כרגע.</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold">{selected.name}</h1>
                <p className="text-sm text-ink-muted">
                  {selectedOrder ? (
                    <>
                      סטטוס: {STATUS_LABEL[selectedOrder.status]}
                      {selectedOrder.submitted_at &&
                        ` · נשלח ב-${new Date(selectedOrder.submitted_at).toLocaleString("he-IL")}`}
                      {selectedOrder.reminder_sent_at &&
                        ` · תזכורת נשלחה ב-${new Date(selectedOrder.reminder_sent_at).toLocaleString("he-IL")}`}
                    </>
                  ) : (
                    "אין הזמנה עבור לקוח זה היום."
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => reminderMutation.mutate()}
                disabled={
                  !selectedOrder ||
                  selectedOrder.status === "submitted" ||
                  reminderMutation.isPending
                }
              >
                {reminderMutation.isPending ? "שולח…" : "שלח תזכורת"}
              </Button>
            </div>

            <OrderLinesEditor
              key={selected.id}
              tradingDayId={openDayId}
              customerCompanyId={selected.id}
              onSubmitted={() => {
                void queryClient.invalidateQueries({
                  queryKey: ["customer-oversight", "orders-for-day", openDayId],
                });
              }}
            />
          </div>
        )
      }
    />
  );
}
