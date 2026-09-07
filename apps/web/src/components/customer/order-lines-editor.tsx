import {
  orderableCatalogInputSchema,
  submitOrderInputSchema,
  toOrderableCatalogRpcArgs,
  toSubmitOrderRpcArgs,
} from "@ori/domain/customer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

import { CommentPopup } from "./comment-popup";
import { formatPrice, groupCatalogByFamily, weekdayDateLabel, type CatalogRow } from "./catalog-grouping";
import { OrderProductList, type OrderFamilyRow } from "./order-product-list";
import { SubmissionConfirmationDialog } from "./submission-confirmation-dialog";

interface DraftLine {
  pallets: string;
  comment: string;
}

function toDraft(rows: CatalogRow[]): Record<string, DraftLine> {
  const draft: Record<string, DraftLine> = {};
  for (const row of rows) {
    draft[row.variety_id] = {
      pallets: row.pallets_ordered ? String(row.pallets_ordered) : "",
      comment: row.comment ?? "",
    };
  }
  return draft;
}

// The one place both the customer's own order screen and the
// distributor's Customer Order Status oversight screen
// (`/backoffice/distributor-customer`) browse the catalog and edit an
// order's lines — same rules either way (get_orderable_catalog_for_customer
// and submit_order both accept "the owning customer, or backoffice"), so
// one component covers both instead of two near-identical copies (R1/R5),
// same precedent as PickLinesEditor in the grower module.
//
// `customerCompanyId` omitted means "my own order" (the customer's own
// screen); supplied, it's the backoffice-on-behalf-of path — the RPC
// layer is what actually enforces who may pass it, not this component.
export function OrderLinesEditor({
  tradingDayId,
  customerCompanyId,
  onSubmitted,
  tradeDate,
}: {
  tradingDayId: string;
  customerCompanyId?: string;
  onSubmitted?: () => void;
  // ISO date, e.g. trading_days.trade_date. Renders the reference design's
  // title + date-pill header inside the list card. Omitted on the
  // backoffice on-behalf-of screen (distributor-customer.tsx), which
  // already renders its own header (company name + order status) above
  // this component.
  tradeDate?: string;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, DraftLine>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commentPopupVarietyId, setCommentPopupVarietyId] = useState<string | null>(null);

  const queryKey = ["customer", "catalog", tradingDayId, customerCompanyId ?? "self"];

  const catalogQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const input = orderableCatalogInputSchema.parse({ tradingDayId, customerCompanyId });
      const { data, error } = await supabase.rpc(
        "get_orderable_catalog_for_customer",
        toOrderableCatalogRpcArgs(input),
      );
      if (error) throw error;
      return data as CatalogRow[];
    },
  });

  useEffect(() => {
    if (!editing && catalogQuery.data) {
      setDraft(toDraft(catalogQuery.data));
    }
  }, [catalogQuery.data, editing]);

  // Same live-invalidation the customer's own screen relies on (see
  // packages/db/migrations/0019_customer-catalog-realtime.sql) — kept
  // identical for the backoffice caller too, rather than a second,
  // divergent behavior: a backoffice user editing a customer's order
  // benefits from the same "no query on an unmodified revisit" cache
  // reuse (apps/web/src/lib/providers.tsx's staleTime) and the same push
  // update when supply/demand changes underneath them.
  useEffect(() => {
    const channel = supabase
      .channel(`customer-catalog-${tradingDayId}-${customerCompanyId ?? "self"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_pick_products" },
        () => {
          void queryClient.invalidateQueries({ queryKey });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_order_products" },
        () => {
          void queryClient.invalidateQueries({ queryKey });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingDayId, customerCompanyId]);

  // The reference design's shop screen: a collapsed row per product
  // family, expanding to that family's varieties — matches
  // get_orderable_catalog_for_customer's own grouping (R6, see
  // 0018_customer-order-functions.sql), not a second, divergent one.
  const families: OrderFamilyRow[] = useMemo(
    () =>
      groupCatalogByFamily(catalogQuery.data ?? []).map((family) => ({
        familyId: family.familyId,
        familyName: family.familyName,
        imageUrl: family.imageUrl,
        varieties: family.varieties.map((row) => ({
          varietyId: row.variety_id,
          varietyName: row.variety_name,
          priceLabel: formatPrice(row),
          packType: row.pack_type,
          pallets: draft[row.variety_id]?.pallets ?? "",
          comment: draft[row.variety_id]?.comment ?? "",
          outOfStock: !row.is_orderable,
        })),
      })),
    [catalogQuery.data, draft],
  );

  const confirmFamilies = useMemo(() => {
    const nonzeroRows = (catalogQuery.data ?? [])
      .map((row) => ({
        ...row,
        pallets_ordered: Number(draft[row.variety_id]?.pallets || 0),
        comment: draft[row.variety_id]?.comment || null,
      }))
      .filter((row) => row.pallets_ordered > 0);
    return groupCatalogByFamily(nonzeroRows);
  }, [catalogQuery.data, draft]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const lines = (catalogQuery.data ?? []).map((row) => ({
        productVarietyId: row.variety_id,
        palletsOrdered: Number(draft[row.variety_id]?.pallets || 0),
        comment: draft[row.variety_id]?.comment || null,
      }));
      const input = submitOrderInputSchema.parse({ tradingDayId, lines, customerCompanyId });
      const { data, error } = await supabase.rpc("submit_order", toSubmitOrderRpcArgs(input));
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      showToast("ההזמנה נשלחה.", "success");
      setEditing(false);
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey });
      onSubmitted?.();
    },
    onError: (error: { message?: string }) => {
      showToast(`השליחה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  function updateLine(varietyId: string, patch: Partial<DraftLine>) {
    setDraft((current) => ({
      ...current,
      [varietyId]: { pallets: "", comment: "", ...current[varietyId], ...patch },
    }));
  }

  function handleDiscard() {
    if (catalogQuery.data) setDraft(toDraft(catalogQuery.data));
    setEditing(false);
  }

  function handleConfirmSubmit() {
    setSubmitting(true);
    submitMutation.mutate(undefined, { onSettled: () => setSubmitting(false) });
  }

  if (catalogQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (families.length === 0) {
    return <p className="text-sm text-ink-muted">אין עדיין מוצרים זמינים להזמנה היום.</p>;
  }

  const activeComment = commentPopupVarietyId ? (draft[commentPopupVarietyId]?.comment ?? "") : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        {tradeDate && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted/60 px-5 py-4">
            <h2 className="font-display text-xl">הזמנת תוצרת</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-border-strong">
              <Icon name="calendar" className="h-3.5 w-3.5" />
              {weekdayDateLabel(tradeDate)}
            </span>
          </div>
        )}
        <OrderProductList
          families={families}
          editable={editing}
          onChangePallets={(varietyId, value) => updateLine(varietyId, { pallets: value })}
          onOpenComment={(varietyId) => setCommentPopupVarietyId(varietyId)}
        />
      </div>

      <ActionBar
        editing={editing}
        canDelete={false}
        onEdit={() => setEditing(true)}
        onDiscard={handleDiscard}
        onSave={() => setConfirmOpen(true)}
      />

      <CommentPopup
        open={commentPopupVarietyId !== null}
        initialValue={activeComment}
        onClose={() => setCommentPopupVarietyId(null)}
        onConfirm={(comment) => {
          if (commentPopupVarietyId) updateLine(commentPopupVarietyId, { comment });
        }}
      />

      <SubmissionConfirmationDialog
        open={confirmOpen}
        families={confirmFamilies}
        confirming={submitting}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmSubmit}
      />
    </div>
  );
}
