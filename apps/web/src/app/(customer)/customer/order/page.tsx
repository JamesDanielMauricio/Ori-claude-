"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { OrderLinesEditor } from "@/components/customer/order-lines-editor";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";

// Customer-facing catalog browsing + order placement (PRD:
// place-edit-today-s-order.md, order-form.md). The actual catalog/draft/
// submit logic lives in OrderLinesEditor, shared with the distributor's
// Customer Order Status oversight screen (/backoffice/distributor-customer)
// — see that component's header comment.
export default function CustomerOrderPage() {
  const supabase = createClient();

  const openDayQuery = useQuery({
    queryKey: ["customer", "open-trading-day"],
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
  const dayId = openDayQuery.data?.id;

  const tradeDateLabel = useMemo(() => {
    if (!openDayQuery.data) return "";
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(new Date(openDayQuery.data.trade_date));
  }, [openDayQuery.data]);

  if (openDayQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!dayId) {
    return <p className="text-sm text-ink-muted">אין יום מסחר פתוח כרגע.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={`הזמנה — ${tradeDateLabel}`}
        subtitle="עדכן כמויות ולחץ שמירה — ההזמנה נשלחת רק לאחר אישור הסיכום."
      />
      <OrderLinesEditor tradingDayId={dayId} />
    </div>
  );
}
