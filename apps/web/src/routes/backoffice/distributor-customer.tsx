import { sendOrderReminderInputSchema, toSendOrderReminderRpcArgs } from "@ori/domain/customer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { formatPallets } from "@/components/arrangement/board-data";
import { CustomerOrdersDialog } from "@/components/arrangement/customer-orders-dialog";
import { ExpandableEntityRow } from "@/components/reference-data/expandable-entity-row";
import {
  FamilyGroupedLines,
  type FamilyGroupedRow,
} from "@/components/reference-data/family-grouped-lines";
import { TwoColumnRowList } from "@/components/reference-data/two-column-row-list";
import { StatusPill } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { nudgeWhatsAppDispatch } from "@/lib/nudge-whatsapp-dispatch";
import { createClient } from "@/lib/supabase/client";
import { useTradingDayView } from "@/lib/trading-day-view";

interface CustomerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
}

interface OrderLineRow {
  id: string;
  pallets_ordered: string;
  comment: string | null;
  product_varieties: {
    id: string;
    name: string;
    family_id: string;
    product_families: { id: string; name: string; image_url: string | null } | null;
  } | null;
}

interface DailyOrderForDay {
  id: string;
  customer_company_id: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  reminder_sent_at: string | null;
  daily_order_products: OrderLineRow[];
}

// Same grouping as distributor-grower.tsx's groupPickLines, mirrored onto
// order lines.
function groupOrderLines(lines: OrderLineRow[]): FamilyGroupedRow[] {
  const families = new Map<string, FamilyGroupedRow>();
  for (const line of lines) {
    const variety = line.product_varieties;
    if (!variety) continue;
    let group = families.get(variety.family_id);
    if (!group) {
      group = {
        familyId: variety.family_id,
        familyName: variety.product_families?.name ?? "",
        imageUrl: variety.product_families?.image_url ?? null,
        lines: [],
      };
      families.set(variety.family_id, group);
    }
    const pallets = Number(line.pallets_ordered) || 0;
    group.lines.push({
      id: line.id,
      varietyName: variety.name,
      quantityLabel: formatPallets(pallets),
      hasQuantity: pallets > 0,
      comment: line.comment,
    });
  }
  const groups = [...families.values()];
  for (const group of groups) {
    group.lines.sort((a, b) => a.varietyName.localeCompare(b.varietyName, "he"));
  }
  return groups.sort((a, b) => a.familyName.localeCompare(b.familyName, "he"));
}

// Distributor-facing "Customer Order Status" oversight (PRD:
// backoffice.md's "distributor+customer" tab — "Distributor as Customer
// View": a shared view used when the Distributor needs to act on a
// customer's behalf). Same shape as distributor-grower.tsx, mirrored onto
// orders: a status-colored name per row, an expand chevron revealing that
// customer's order grouped by family (read-only), a pencil that opens
// CustomerOrdersDialog — the exact same OrderLinesEditor the customer's own
// screen and the arrangement board's pencil already use
// (get_orderable_catalog_for_customer and submit_order both accept "the
// owning customer, or backoffice") — and a bell that resends the order
// reminder.
//
// Replaced the same master-detail layout distributor-grower.tsx did, for
// the same reason: scanning who hasn't ordered yet used to be a one-
// customer-at-a-time question. See that file's own comment for the fuller
// rationale — it applies here unchanged.
export default function DistributorAsCustomerPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [ordersDialogCustomer, setOrdersDialogCustomer] = useState<CustomerCompany | null>(null);

  // The day this oversight screen shows: the live open day by default, or —
  // once the sidebar's picker has pinned one (lib/trading-day-view.tsx) —
  // that specific date's day instead. `isLive` is what gates every write
  // control below, the same rule the arrangement board's popup follows.
  const dayView = useTradingDayView();
  const dayId = dayView.day?.id;

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

  // Orders AND their lines in one request — see distributor-grower.tsx's
  // identical comment on picksForDayQuery for why: embedding
  // daily_order_products here is what makes expanding any row free.
  const ordersForDayQueryKey = ["customer-oversight", "orders-for-day", dayId] as const;

  const ordersForDayQuery = useQuery({
    queryKey: ordersForDayQueryKey,
    enabled: !!dayId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_orders")
        .select(
          `id, customer_company_id, status, submitted_at, reminder_sent_at,
           daily_order_products(id, pallets_ordered, comment, product_varieties(id, name, family_id, product_families(id, name, image_url)))`,
        )
        .eq("trading_day_id", dayId!);
      if (error) throw error;
      return data as unknown as DailyOrderForDay[];
    },
  });

  // Push-triggered refresh — same trigger-only shape as distributor-
  // grower.tsx's, mirrored onto orders: an order edited elsewhere (the
  // customer's own screen, the arrangement board's pencil, or the
  // arrangement board pushing surplus onto a zero-pallet line) has to show
  // up here without a manual reload.
  useEffect(() => {
    if (!dayId) return;
    const channel = supabase
      .channel(`customer-oversight-orders-${dayId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_orders" }, () => {
        void queryClient.invalidateQueries({
          queryKey: ["customer-oversight", "orders-for-day", dayId],
        });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_order_products" },
        () => {
          void queryClient.invalidateQueries({
            queryKey: ["customer-oversight", "orders-for-day", dayId],
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dayId, supabase, queryClient]);

  const orderByCustomerId = useMemo(() => {
    const map = new Map<string, DailyOrderForDay>();
    for (const order of ordersForDayQuery.data ?? []) map.set(order.customer_company_id, order);
    return map;
  }, [ordersForDayQuery.data]);

  // Alphabetical once, here — both the single-column and two-column layouts
  // (TwoColumnRowList) read off this same order.
  const sortedCustomers = useMemo(() => {
    const rows = customersQuery.data ?? [];
    const needle = search.trim().toLocaleLowerCase("he");
    const filtered = needle
      ? rows.filter((row) => row.name.toLocaleLowerCase("he").includes(needle))
      : rows;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [customersQuery.data, search]);

  // One mutation, keyed per call by `dailyOrderId` — see distributor-
  // grower.tsx's identical reminderMutation for why `variables` is what
  // lets each row's bell know whether it is the one currently sending.
  // `reminder_sent_at` is real, persisted state on the order row — patch it
  // optimistically like any other field, same treatment as
  // distributor-grower.tsx's identical reminderMutation.
  const reminderOptimistic = optimisticUpdate<DailyOrderForDay[], string>(
    queryClient,
    ordersForDayQueryKey,
    (orders, dailyOrderId) =>
      orders?.map((order) =>
        order.id === dailyOrderId
          ? { ...order, reminder_sent_at: new Date().toISOString() }
          : order,
      ),
  );

  const reminderMutation = useMutation({
    mutationFn: async (dailyOrderId: string) => {
      const input = sendOrderReminderInputSchema.parse({ dailyOrderId });
      const { error } = await supabase.rpc(
        "send_order_reminder",
        toSendOrderReminderRpcArgs(input),
      );
      if (error) throw error;
    },
    onMutate: reminderOptimistic.onMutate,
    onSuccess: () => {
      showToast("התזכורת נשלחה.", "success");
      void queryClient.invalidateQueries({ queryKey: ordersForDayQueryKey });
      // The RPC above already queued the WhatsApp send durably — this just
      // asks the dispatcher to drain it right now instead of waiting for the
      // next scheduled run. See nudge-whatsapp-dispatch.ts for why this is
      // fire-and-forget and can never fail this mutation.
      nudgeWhatsAppDispatch(supabase);
    },
    onError: mergeOnError(reminderOptimistic.onError, (error: { message?: string }) => {
      showToast(`שליחת התזכורת נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    }),
  });

  function toggleExpanded(customerId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (!next.delete(customerId)) next.add(customerId);
      return next;
    });
  }

  const isLoading = customersQuery.isLoading || (!!dayId && ordersForDayQuery.isLoading);

  const rows = sortedCustomers.map((customer) => {
    const order = orderByCustomerId.get(customer.id) ?? null;
    const tone = !order ? "warning" : order.status === "submitted" ? "accent" : "neutral";
    const caption =
      order?.status === "submitted" && order.submitted_at
        ? `נשלח ב-${new Date(order.submitted_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`
        : null;
    const families = order ? groupOrderLines(order.daily_order_products) : [];
    const reminding = reminderMutation.isPending && reminderMutation.variables === order?.id;

    return (
      <ExpandableEntityRow
        key={customer.id}
        name={customer.name}
        tone={tone}
        caption={caption}
        expanded={expandedIds.has(customer.id)}
        onToggle={() => toggleExpanded(customer.id)}
        onEdit={() => setOrdersDialogCustomer(customer)}
        editLabel={`ערוך את הזמנת ${customer.name}`}
        onRemind={() => order && reminderMutation.mutate(order.id)}
        remindLabel={`שלח תזכורת ל${customer.name}`}
        remindDisabled={
          !dayView.isLive || !order || order.status === "submitted" || reminderMutation.isPending
        }
        reminding={reminding}
      >
        <FamilyGroupedLines families={families} emptyLabel="אין עדיין הזמנה עבור לקוח זה." />
      </ExpandableEntityRow>
    );
  });

  return (
    <>
      <PageHeader
        title="בשם לקוח"
        subtitle="צפייה ועריכה של הזמנות היום בשם כל לקוח, ושליחת תזכורות."
        actions={
          !dayView.isLive ? (
            <StatusPill tone="warning">צפייה בעבר — לא ניתן לערוך</StatusPill>
          ) : undefined
        }
      />

      <label className="relative mb-4 block max-w-xs">
        <span className="sr-only">חיפוש לקוח</span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-subtle"
        >
          <Icon name="search" className="h-4 w-4" />
        </span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="חיפוש לקוח…"
          className="h-10 w-full rounded-md bg-surface ps-9 pe-3 text-sm text-ink shadow-card ring-1 ring-inset ring-border-strong outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:ring-2 focus:ring-accent/40"
        />
      </label>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : customersQuery.isError || ordersForDayQuery.isError ? (
        <QueryError
          what="לקוחות"
          onRetry={() => {
            void customersQuery.refetch();
            void ordersForDayQuery.refetch();
          }}
          retrying={customersQuery.isFetching || ordersForDayQuery.isFetching}
        />
      ) : !dayId ? (
        // Without a day, no customer has a `daily_orders` header — the
        // list below would otherwise render every row as "אין הזמנה" and
        // let its pencil open CustomerOrdersDialog with no real day for
        // OrderLinesEditor's catalog RPC to query against. Blocked here,
        // same message the original master-detail screen's detail pane
        // used, rather than letting a pencil discover the problem itself.
        <EmptyState
          icon="clock"
          title={dayView.isLive ? "אין יום מסחר פתוח" : "לא נמצא יום מסחר בתאריך זה"}
          hint={
            dayView.isLive
              ? "פתח יום עסקים בסרגל הצד כדי לנהל הזמנות בשם לקוחות."
              : "בחר תאריך אחר בסרגל הצד, או חזור ליום הפעיל."
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title="אין לקוחות להצגה"
          hint={search ? "נסה מונח חיפוש אחר." : "אין לקוחות פעילים במערכת."}
        />
      ) : (
        <TwoColumnRowList rows={rows} />
      )}

      <CustomerOrdersDialog
        tradingDayId={dayId ?? ""}
        customerId={ordersDialogCustomer?.id ?? null}
        customerName={ordersDialogCustomer?.name ?? ""}
        onClose={() => setOrdersDialogCustomer(null)}
        onSubmitted={() => {
          void queryClient.invalidateQueries({
            queryKey: ["customer-oversight", "orders-for-day", dayId],
          });
          setOrdersDialogCustomer(null);
        }}
        readOnly={!dayView.isLive}
      />
    </>
  );
}
