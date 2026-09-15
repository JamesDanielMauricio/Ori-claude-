import {
  orderableCatalogInputSchema,
  submitOrderInputSchema,
  toOrderableCatalogRpcArgs,
  toSubmitOrderRpcArgs,
} from "@ori/domain/customer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { Icon } from "@/components/ui/icon";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { formatVarietyName } from "@/lib/variety-label";

import { CommentPopup } from "./comment-popup";
import {
  formatPrice,
  groupCatalogByFamily,
  groupCatalogForBrowsing,
  weekdayDateLabel,
  type CatalogRow,
} from "./catalog-grouping";
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

// The draft as submit_order would actually receive it. Used for both the
// submission itself and the "is there anything to save?" comparison behind
// the ActionBar's buttons, so that question is answered by the payload
// rather than by the state of the controls.
//
// Which matters most for an untouched row: toDraft leaves a variety nobody
// ordered as "" while the dropdown displays it as "0", so picking "0" on
// such a row writes "0" into the draft and a textual comparison would call
// that an edit. Both sides go through Number(... || 0) here, so 0 === 0 and
// the order correctly reads as unchanged.
function toSubmittedLines(rows: CatalogRow[], draft: Record<string, DraftLine>) {
  return rows.map((row) => ({
    productVarietyId: row.variety_id,
    palletsOrdered: Number(draft[row.variety_id]?.pallets || 0),
    comment: draft[row.variety_id]?.comment || null,
  }));
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
  readOnly = false,
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
  // The ONE switch between "this order can be changed" and "this order can
  // only be read" — there is deliberately no second, per-session "ערוך" gate
  // layered on top of it (this editor had one until now, and so did
  // PickLinesEditor, in the grower module). Two reasons it doesn't belong
  // here:
  //
  // A gate answers "does this person intend to edit?". But an order is only
  // ever editable when the shop is open, and when it is open, editing is the
  // entire purpose of the screen — the question the gate asked had one
  // answer, so it cost a click and a scroll to the bottom of a
  // several-hundred-row catalogue to say "yes" every single time. What
  // actually decides editability is a fact about the trading day, and the
  // hosts below read it: the customer's own screen from
  // `trading_days.phase === "shop_open"` (routes/customer/order.tsx), the
  // backoffice ones from whether the sidebar's date picker
  // (lib/trading-day-view.tsx) has pinned a day other than the live one.
  //
  // This editor has no status of its own to fall back on the way a pick does
  // (`daily_orders.status` is only ever "open"/"submitted"; it never locks),
  // which is why every host has to pass this rather than it being derivable
  // here. Without it, editing and submitting an order for a closed
  // historical day would render as fully live right up until the server
  // rejected the write.
  //
  // Read-only means inputs disabled, comments as plain text, and no
  // ActionBar at all — so a locked order shows no save button to press.
  readOnly?: boolean;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const editing = !readOnly;
  const [draft, setDraft] = useState<Record<string, DraftLine>>({});
  // See the re-seeding effect below.
  const touched = useRef(false);
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

  // Keeps the draft tracking the server without clobbering typing in
  // progress. The gate used to supply an idle state that was always safe to
  // re-seed from ("not editing"); with it gone, the first keystroke is what
  // marks the draft as the user's — seed freely until then, hold still after,
  // until the next save or discard resets `touched`. This matters more here
  // than in the pick editor: the realtime channel below invalidates this
  // query whenever ANY pick or order line on the day changes, which on the
  // arrangement board is every time the distributor presses ✓ on somebody
  // else's card.
  useEffect(() => {
    if (!catalogQuery.data) return;
    if (touched.current) return;
    setDraft(toDraft(catalogQuery.data));
  }, [catalogQuery.data]);

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
  //
  // groupCatalogForBrowsing, not groupCatalogByFamily directly: on a
  // catalog of hundreds of varieties, what this customer already ordered
  // has to be reachable without scrolling past everything they haven't
  // touched — see that function's own comment for why the split is keyed
  // off the server row, not `draft`.
  // A dropdown capped to remaining stock only makes sense as a promise to
  // the person it constrains — the customer ordering for themselves.
  // Backoffice editing a customer's order on their behalf (customerCompanyId
  // supplied) keeps the free-typed number input: staff may deliberately
  // exceed the customer's own cap, same as submit_order never enforces it
  // on that path either (see 0042_customer-order-cap.sql).
  const quantityMode = customerCompanyId ? "number" : "dropdown";

  const families: OrderFamilyRow[] = useMemo(
    () =>
      groupCatalogForBrowsing(catalogQuery.data ?? []).map((family) => ({
        familyId: family.familyId,
        familyName: family.familyName,
        imageUrl: family.imageUrl,
        varieties: family.varieties.map((row) => ({
          varietyId: row.variety_id,
          varietyName: formatVarietyName(row.variety_name, row.sizes),
          priceLabel: formatPrice(row),
          packType: row.pack_type,
          pallets: draft[row.variety_id]?.pallets ?? "",
          comment: draft[row.variety_id]?.comment ?? "",
          outOfStock: !row.is_orderable,
          maxOrderable: row.max_orderable_for_customer,
        })),
      })),
    [catalogQuery.data, draft],
  );

  // How many varieties this draft actually asks for. Shown in the pinned
  // action bar, which needs it twice over: a customer scrolling a
  // several-hundred-row catalogue has no other way to see how much of it
  // they've filled in without scrolling back through all of it, and the bar
  // itself is full-width — with only a button in it, it read as an empty
  // band rather than a designed footer.
  //
  // Deliberately a count of products and not a sum of quantities: pack_type
  // is per-variety (משטחים vs ארגזים, see OrderProductList), so one total
  // across a mixed order would be a number in no unit at all.
  const filledProductCount = useMemo(() => {
    let count = 0;
    for (const row of catalogQuery.data ?? []) {
      if (Number(draft[row.variety_id]?.pallets || 0) > 0) count += 1;
    }
    return count;
  }, [catalogQuery.data, draft]);

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

  // As with PickLinesEditor: the visible quantities are already the draft,
  // live as the customer types, so submitting doesn't change what's on
  // screen. What it does change is `dirty` (below) — derived from comparing
  // the draft against `catalogQuery.data` — which otherwise stays "unsaved"
  // until the round trip lands and this cache refetches. Patching the cache
  // here resolves that the instant "שמור" is pressed; a rejection rolls it
  // back, restoring `dirty` and the ActionBar along with it.
  const submitOptimistic = optimisticUpdate<CatalogRow[], void>(queryClient, queryKey, (rows) => {
    if (!rows) return rows;
    return rows.map((row) => {
      const line = draft[row.variety_id];
      return line
        ? { ...row, pallets_ordered: Number(line.pallets || 0), comment: line.comment || null }
        : row;
    });
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const lines = toSubmittedLines(catalogQuery.data ?? [], draft);
      const input = submitOrderInputSchema.parse({ tradingDayId, lines, customerCompanyId });
      const { data, error } = await supabase.rpc("submit_order", toSubmitOrderRpcArgs(input));
      if (error) throw error;
      return data;
    },
    onMutate: submitOptimistic.onMutate,
    onSuccess: () => {
      showToast("ההזמנה נשלחה.", "success");
      setConfirmOpen(false);
      // The draft now matches the server, so let the refetch re-seed it —
      // otherwise the editor stays frozen on this draft and stops reflecting
      // anything anyone else changes.
      touched.current = false;
      void queryClient.invalidateQueries({ queryKey });
      onSubmitted?.();
    },
    onError: mergeOnError(submitOptimistic.onError, (error: { message?: string }) => {
      showToast(`השליחה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    }),
  });

  function updateLine(varietyId: string, patch: Partial<DraftLine>) {
    touched.current = true;
    setDraft((current) => ({
      ...current,
      [varietyId]: { pallets: "", comment: "", ...current[varietyId], ...patch },
    }));
  }

  // The order with no unsaved edits — what "בטל שינויים" puts back, and what
  // the draft is measured against to decide whether either button has
  // anything to do.
  //
  // Worth more here than on the reference-data forms: a customer's order is
  // several hundred rows, so "did I actually change anything?" is not a
  // question they can answer by looking. And a no-op submit is not free —
  // submit_order re-stamps submitted_at and enqueues an order_submitted
  // notification to backoffice (migration 0031, id 6), so a reflexive press
  // of "שמור" tells the office an order changed when it did not.
  const baselineDraft = toDraft(catalogQuery.data ?? []);
  const dirty = hasChanges(
    toSubmittedLines(catalogQuery.data ?? [], draft),
    toSubmittedLines(catalogQuery.data ?? [], baselineDraft),
  );

  function handleDiscard() {
    // Puts the fields back to the stored order, and nothing else — there is
    // no read-only mode for this button to drop into any more. Clearing
    // `touched` also hands the draft back to the re-seeding effect above, so
    // the screen resumes tracking what other people change.
    setDraft(baselineDraft);
    touched.current = false;
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

  // "Nothing is available to order today" and "the catalog request failed"
  // rendered identically before, and the first is the one a customer acts on
  // — they close the tab. The catalog is the whole screen, so a failure here
  // has to say so.
  if (catalogQuery.isError) {
    return (
      <QueryError
        what="קטלוג המוצרים"
        onRetry={() => void catalogQuery.refetch()}
        retrying={catalogQuery.isFetching}
      />
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
            <h2 className="text-sm font-semibold">הזמנת תוצרת</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted ring-1 ring-inset ring-border-strong">
              <Icon name="calendar" className="h-3.5 w-3.5" />
              {weekdayDateLabel(tradeDate)}
            </span>
          </div>
        )}
        <OrderProductList
          families={families}
          editable={editing}
          quantityMode={quantityMode}
          onChangePallets={(varietyId, value) => updateLine(varietyId, { pallets: value })}
          onOpenComment={(varietyId) => setCommentPopupVarietyId(varietyId)}
        />
      </div>

      {!readOnly && (
        <ActionBar
          // Never false: this bar only renders when the order is editable at
          // all, so the mode it would have switched to no longer exists. No
          // `onEdit` is passed for the same reason — see ActionBar's own
          // comment on that prop.
          editing
          dirty={dirty}
          canDelete={false}
          // Sticky on every host, the customer's own screen included: this
          // is exactly the "several hundred rows" case ActionBar's sticky
          // comment describes — "שמור" sitting under the whole catalogue
          // meant scrolling past all of it to commit a change made at the
          // top.
          sticky
          onDiscard={handleDiscard}
          onSave={() => setConfirmOpen(true)}
          // `ms-auto` rather than a `justify-between` on the bar itself:
          // the buttons are ActionBar's own direct children, so spacing the
          // whole row would push them apart from each other too.
          extra={
            <span className="ms-auto text-xs font-medium text-ink-muted">
              {filledProductCount === 0
                ? "לא נבחרו מוצרים"
                : `${filledProductCount === 1 ? "מוצר אחד" : `${filledProductCount} מוצרים`} בהזמנה`}
            </span>
          }
        />
      )}

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
