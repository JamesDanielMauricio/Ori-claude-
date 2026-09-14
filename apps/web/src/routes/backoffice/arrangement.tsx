import {
  ARRANGEMENT_ERROR_CODES,
  arrangeToCustomerInputSchema,
  toArrangeToCustomerRpcArgs,
  toDeleteArrangementRecordRpcArgs,
  toUpdateArrangementRecordRpcArgs,
  updateArrangementRecordInputSchema,
} from "@ori/domain/arrangement";
import {
  LIFECYCLE_ERROR_CODES,
  revertPickToDraftInputSchema,
  submitPickInputSchema,
  toRevertPickToDraftRpcArgs,
  toSubmitPickRpcArgs,
} from "@ori/domain/lifecycle-engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  buildBoard,
  findPickLine,
  flattenRecords,
  markSelected,
  type BoardCompany,
  type BoardOrder,
  type BoardPick,
  type BoardRecord,
  type GrowerSupply,
  type PickSelection,
} from "@/components/arrangement/board-data";
import {
  CustomerDemandBoard,
  type AllocationPatch,
  type ArrangeRequest,
} from "@/components/arrangement/customer-demand-board";
import { CustomerOrdersDialog } from "@/components/arrangement/customer-orders-dialog";
import { GrowerPickDialog } from "@/components/arrangement/grower-pick-dialog";
import { GrowerSupplyColumn } from "@/components/arrangement/grower-supply-column";
import { PriceEditDialog } from "@/components/arrangement/price-edit-dialog";
import { ProductStrip } from "@/components/arrangement/product-strip";
import { ArrangementRecordsSection } from "@/components/arrangement/records-table";
import { StatusPill } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { useTradingDayView } from "@/lib/trading-day-view";

// The whole screen's data as ONE nested row — see the board query below for
// why this is a single shape rather than seven separate queries.
interface TradingDay {
  id: string;
  trade_date: string;
  phase: "initiated" | "shop_open" | "shop_closed" | "closed";
  // `unique(trading_day_id)` on daily_arrangements makes this a
  // one-to-one embed, so PostgREST returns an object here, not an array.
  daily_arrangements: DailyArrangement | null;
  daily_picks: BoardPick[];
  daily_orders: BoardOrder[];
}

interface DailyArrangement {
  id: string;
  status: "open" | "closed";
  arrangement_records: BoardRecord[];
}

// The distributor's matchmaking workspace (PRD: arrangement-view.md), laid
// out the way the source app's own arrangement screen was.
//
// The screen has one subject at a time: a single grower's pick line, chosen
// by clicking a product inside a grower's card in the right-hand column.
// Everything else follows from it. The strip across the top shows that
// product's four figures for the day (נקטף / הוזמן / חולק / נותר) and which
// grower's pallets are being handed out; the customer list on the left
// splits at a dashed rule into the people who ordered that product and the
// people who did not, and each customer above the rule gets a quantity box
// and a ✓ that commits pallets off the selected line. The + below the rule
// moves a customer up and offers them the surplus.
//
// That is the PRD's "supply and demand side by side so the distributor can
// visually match" requirement with the matching made direct — an allocation
// is written on the order line it satisfies, against a named grower's lot,
// rather than assembled in a wizard and audited afterwards in a flat table
// of every record on the day. The table is still here, collapsed at the
// bottom, for the whole-day read and for price edits; /backoffice/new-
// arrangement presents the same day the other way round, as a product ×
// customer grid, for when the question is "where did everything go?" rather
// than "who gets this lot?" — reachable from BackofficeNav rather than from
// a button on this page. Closing the arrangement is likewise not a control
// here — it's the
// same close_arrangement RPC the sidebar's BusinessDayPanel already exposes
// on every backoffice screen as "סגירת יום עסקים", so this page doesn't
// duplicate it.
//
// The one write this screen makes that no other screen can is
// `arrange_to_customer` (migration 0040): it creates the order line, at zero
// pallets, for a customer who never ordered the product being pushed to
// them. See that migration for why the demand-side ceiling had to learn
// about zero-pallet lines.
export default function ArrangementPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // The grower pick line being allocated from. Everything the customer list
  // does — which half of the dashed rule a card falls on, which row gets a
  // quantity box, what a ✓ writes against — reads off this one value.
  const [selection, setSelection] = useState<PickSelection | null>(null);
  const [expandedGrowerId, setExpandedGrowerId] = useState<string | null>(null);
  const [priceEditVarietyId, setPriceEditVarietyId] = useState<string | null>(null);
  const [ordersCustomerId, setOrdersCustomerId] = useState<string | null>(null);
  // Held as the whole row rather than an id: the dialog needs the pick's id,
  // its status and the grower's name, and the row is about to be replaced by
  // a refetch the moment the editor saves — reading them back out of the
  // board afterwards would race that.
  const [pickDialogGrower, setPickDialogGrower] = useState<GrowerSupply | null>(null);

  // Customers the distributor has moved above the dashed rule with +, who
  // have no order line for the selected product yet.
  //
  // Purely client-side, and that is the requirement rather than an
  // optimisation: pressing + must not write anything. A customer promoted
  // and then thought better of is a customer nothing happened to — no empty
  // order line left behind for the shop screens and the demand totals to
  // trip over. The first write is ✓.
  const [promoted, setPromoted] = useState<ReadonlySet<string>>(() => new Set());

  // The day this board shows: the live open day by default, or — once the
  // sidebar's picker has pinned one (lib/trading-day-view.tsx) — that
  // specific date's day instead, whatever its phase. Resolved separately
  // from the board data below because it is also what every OTHER
  // date-aware backoffice screen resolves through the same shared query
  // key, so a lifecycle transition anywhere refetches this once rather
  // than each screen re-deriving "is there an open day" on its own.
  const dayView = useTradingDayView();
  const day = dayView.day;

  // Everything else in ONE request, once the day above is known. Every
  // table here hangs off that day by a foreign key, so PostgREST can
  // return the entire tree in a single round trip — the arrangement +
  // records, every grower's pick and pick lines, every customer's order
  // and order lines, and each line's variety/family for labelling.
  //
  // This replaced a 7-query chain that was 3 round trips deep: the day had
  // to land before picks/orders could be asked for, and those had to land
  // before the varieties they referenced could be looked up. None of that
  // was a real data dependency — the children all key off the day's id,
  // which PostgREST already knows how to follow. Measured against this
  // project's Supabase region (ap-northeast-1), each hop cost ~130-300ms,
  // so the waterfall was the dominant cost of opening this screen, not the
  // query work itself.
  //
  // The redesign added four fields to this same tree rather than a second
  // query for any of them: pick/order `status` (the cards' state chips),
  // `pickup_time` (the growers column is ordered by collection time),
  // per-line `comment` (shown under the line it belongs to, as in the
  // reference), and the family's `image_url` (migration 0036) for the
  // product photos. All are columns on rows already being fetched, so the
  // request count is unchanged.
  //
  // Also embedded per order: `order_submission_logs`, the append-only audit
  // trail submit_order already writes on every customer submission (0017,
  // "for dispute resolution"). The customer list uses it to show a line's
  // pallet count next to what it was one submission ago, so a distributor
  // can see "they just changed this" instead of only ever seeing the latest
  // number. Still one request — it's a fourth child table alongside picks,
  // orders and records, not a second query.
  //
  // `companies` stays separate below: it's whole-table reference data with
  // no dependency on the day, so it starts immediately and resolves in
  // parallel rather than adding a hop.
  const boardDataQueryKey = ["arrangement", "board-data", day?.id ?? null] as const;

  const boardDataQuery = useQuery({
    queryKey: boardDataQueryKey,
    enabled: !!day?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select(
          `id, trade_date, phase,
           daily_arrangements(id, status, arrangement_records(id, daily_pick_product_id, daily_order_product_id, customer_company_id, quantity_pallets, price, price_type)),
           daily_picks(id, grower_company_id, status, pickup_time, daily_pick_products(id, daily_pick_id, product_variety_id, pallets_picked, comment, product_varieties(id, name, family_id, product_families(name, image_url)))),
           daily_orders(id, customer_company_id, status, daily_order_products(id, daily_order_id, product_variety_id, pallets_ordered, comment, product_varieties(id, name, family_id, product_families(name, image_url))), order_submission_logs(id, snapshot, created_at))`,
        )
        .eq("id", day!.id)
        .maybeSingle();
      if (error) throw error;
      // numeric columns come back as bare JSON numbers over PostgREST, not
      // decimal-preserving strings — see docs/SCHEMA_DECISIONS.md.
      return data as unknown as TradingDay | null;
    },
  });

  // Push-triggered refresh of the board: every table the query above embeds
  // (both the parent day/arrangement rows and the pick/order line tables,
  // since a line edit — pallets picked, order quantity — never bumps its
  // parent) is in the realtime publication (packages/db/migrations/
  // 0041_expand-realtime-publication.sql). Same trigger-only shape as
  // order-lines-editor.tsx: the payload is never read, only used to
  // re-run this RLS-governed query. One channel per open day, torn down
  // when the day changes or the screen unmounts.
  useEffect(() => {
    if (!day?.id) return;
    const dayId = day.id;
    const queryKey = ["arrangement", "board-data", dayId];
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey });
    };

    const channel = supabase
      .channel(`arrangement-board-${dayId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_arrangements" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_picks" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_orders" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "arrangement_records" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_pick_products" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_order_products" }, invalidate)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [day?.id, supabase, queryClient]);

  const companiesQuery = useQuery({
    queryKey: ["arrangement", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, default_pickup_time")
        .in("type", ["grower", "customer"]);
      if (error) throw error;
      return data as BoardCompany[];
    },
  });

  const boardDay = boardDataQuery.data ?? null;
  const arrangement = boardDay?.daily_arrangements ?? null;

  // One derivation for the whole screen, memoized on the query results only
  // — so selecting a different product (below) doesn't re-total the day.
  const board = useMemo(
    () =>
      buildBoard({
        picks: boardDay?.daily_picks ?? [],
        orders: boardDay?.daily_orders ?? [],
        records: arrangement?.arrangement_records ?? [],
        companies: companiesQuery.data ?? [],
      }),
    [boardDay, arrangement, companiesQuery.data],
  );

  // Resolved against the live board rather than synced in an effect: if the
  // selected pick line is gone — the grower's line deleted, the day moved on
  // — this comes back null and the screen falls back to "nothing selected"
  // in the same render, instead of painting a stale strip and correcting it
  // a frame later.
  //
  // There is deliberately no default selection. The whole board is an action
  // against one grower's pallets, and auto-picking a lot on load would put a
  // ✓ next to somebody's name that nobody chose.
  const selectedPickLine = useMemo(
    () => findPickLine(board, selection?.pickLineId ?? null),
    [board, selection],
  );
  const effectiveSelection = selectedPickLine ? selection : null;
  const effectiveVarietyId = effectiveSelection?.varietyId ?? null;

  const view = useMemo(() => markSelected(board, effectiveVarietyId), [board, effectiveVarietyId]);

  const selectedProduct = useMemo(
    () => view.products.find((product) => product.varietyId === effectiveVarietyId) ?? null,
    [view.products, effectiveVarietyId],
  );

  const flatRecords = useMemo(() => flattenRecords(view.customers), [view.customers]);

  const ordersCustomerName =
    view.customers.find((customer) => customer.customerId === ordersCustomerId)?.customerName ?? "";

  // The whole board is one cached object (boardDataQuery above); every
  // mutation below that touches an arrangement record reaches into the same
  // `daily_arrangements.arrangement_records` array and replaces it, rather
  // than hand-patching the derived totals — `buildBoard`'s useMemo recomputes
  // every total (חולק/נותר/OOS, per-grower and per-customer sums) from this
  // array automatically, so nothing here needs to know how to total pallets.
  function recordsOptimistic<TVariables>(
    updater: (records: BoardRecord[], variables: TVariables, current: TradingDay) => BoardRecord[],
  ) {
    return optimisticUpdate<TradingDay | null, TVariables>(
      queryClient,
      boardDataQueryKey,
      (current, variables) =>
        current?.daily_arrangements
          ? {
              ...current,
              daily_arrangements: {
                ...current.daily_arrangements,
                arrangement_records: updater(
                  current.daily_arrangements.arrangement_records,
                  variables,
                  current,
                ),
              },
            }
          : current,
    );
  }

  const deleteOptimistic = recordsOptimistic<string>((records, recordId) =>
    records.filter((record) => record.id !== recordId),
  );

  const deleteMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase.rpc(
        "delete_arrangement_record",
        toDeleteArrangementRecordRpcArgs({ id: recordId }),
      );
      if (error) throw error;
    },
    onMutate: deleteOptimistic.onMutate,
    onSuccess: () => {
      showToast("השיוך נמחק.", "success");
      // Records are nested inside the board query's single response now,
      // so refetching the board is what picks up the change.
      void queryClient.invalidateQueries({ queryKey: boardDataQueryKey });
    },
    onError: mergeOnError(deleteOptimistic.onError, (error: RpcError) => {
      showToast(`המחיקה נכשלה: ${describeRpcError(error)}`, "error");
    }),
  });

  const updateOptimistic = recordsOptimistic<AllocationPatch>((records, patch) =>
    records.map((record) =>
      record.id === patch.id
        ? {
            ...record,
            quantity_pallets: patch.quantityPallets,
            price: patch.price,
            price_type: patch.priceType,
          }
        : record,
    ),
  );

  const updateMutation = useMutation({
    mutationFn: async (input: AllocationPatch) => {
      const parsed = updateArrangementRecordInputSchema.parse(input);
      const { error } = await supabase.rpc(
        "update_arrangement_record",
        toUpdateArrangementRecordRpcArgs(parsed),
      );
      if (error) throw error;
    },
    onMutate: updateOptimistic.onMutate,
    onSuccess: () => {
      showToast("השיוך עודכן.", "success");
      void queryClient.invalidateQueries({ queryKey: boardDataQueryKey });
    },
    onError: mergeOnError(updateOptimistic.onError, (error: RpcError) => {
      showToast(`העדכון נכשל: ${describeRpcError(error)}`, "error");
      // Refetch on failure too: an INVALID_STATE or OVER_ALLOCATION rejection
      // usually means this screen's copy of the day is behind whatever caused
      // it, so the board should re-read rather than argue with the server.
      void queryClient.invalidateQueries({ queryKey: boardDataQueryKey });
    }),
  });

  // Resolves to whether the write actually landed, and never rejects — the
  // toast is already raised by `onError` above, so the boolean is the only
  // thing callers need. The board's inline editor puts its input back when
  // this comes back false; a rejected quantity left sitting in the box beside
  // a "חולק" total that disagrees with it is worse than no edit at all,
  // and the re-seed-from-server guard inside the row cannot catch it because
  // a refused update leaves the stored value untouched.
  const saveAllocation = async (patch: AllocationPatch): Promise<boolean> => {
    try {
      await updateMutation.mutateAsync(patch);
      return true;
    } catch {
      return false;
    }
  };

  const arrangeOptimistic = recordsOptimistic<ArrangeRequest>((records, request, current) => {
    if (!effectiveSelection) return records;
    const pickLineId = effectiveSelection.pickLineId;
    if (request.existing) {
      // Already has a record off THIS pick line — the ✓ is editing its
      // quantity, same shape as updateMutation above.
      const existingRecordId = request.existing.recordId;
      return records.map((record) =>
        record.id === existingRecordId
          ? { ...record, quantity_pallets: request.quantityPallets }
          : record,
      );
    }
    // A brand-new record off this pick line. Only constructible when the
    // customer already has an order line for the selected variety, because
    // a record needs a real `daily_order_product_id` to be valid — for a
    // "promoted" customer with no order line yet, arrange_to_customer
    // creates that line itself (see this mutation's own header comment
    // below), and its id isn't knowable client-side before that happens.
    // That one case falls back to the existing invalidate-on-settle
    // refetch instead of being faked here.
    const orderLineId = current.daily_orders
      .find((order) => order.customer_company_id === request.customerId)
      ?.daily_order_products.find(
        (line) => line.product_variety_id === effectiveSelection.varietyId,
      )?.id;
    if (!orderLineId) return records;
    return [
      ...records,
      {
        id: `optimistic-${crypto.randomUUID()}`,
        daily_pick_product_id: pickLineId,
        daily_order_product_id: orderLineId,
        customer_company_id: request.customerId,
        quantity_pallets: request.quantityPallets,
        price: null,
        price_type: null,
      },
    ];
  });

  // The ✓ button on a customer row. One RPC whether or not anything exists
  // yet: arrange_to_customer upserts the arrangement record and, for a
  // customer who never ordered this variety, creates their order line at
  // zero pallets on the way through. Doing that client-side would be two
  // writes with no transaction around them — an order line could be created
  // and the arrangement then rejected, leaving a phantom line behind.
  const arrangeMutation = useMutation({
    mutationFn: async ({ customerId, quantityPallets, existing }: ArrangeRequest) => {
      if (!effectiveSelection) throw new Error("no pick line selected");
      const parsed = arrangeToCustomerInputSchema.parse({
        dailyPickProductId: effectiveSelection.pickLineId,
        customerCompanyId: customerId,
        quantityPallets,
        // Passed through so the RPC has something to COALESCE onto an
        // existing record; null on a fresh one leaves pricing to
        // close_arrangement, exactly as the New Arrangement wizard does.
        price: existing?.price ?? null,
        priceType: existing?.priceType ?? null,
      });
      const { error } = await supabase.rpc(
        "arrange_to_customer",
        toArrangeToCustomerRpcArgs(parsed),
      );
      if (error) throw error;
    },
    onMutate: arrangeOptimistic.onMutate,
    onSuccess: () => {
      showToast("הסידור נשמר.", "success");
      void queryClient.invalidateQueries({ queryKey: boardDataQueryKey });
    },
    onError: mergeOnError(arrangeOptimistic.onError, (error: RpcError) => {
      showToast(`שמירת הסידור נכשלה: ${describeRpcError(error)}`, "error");
      void queryClient.invalidateQueries({ queryKey: boardDataQueryKey });
    }),
  });

  const arrange = async (request: ArrangeRequest): Promise<boolean> => {
    try {
      await arrangeMutation.mutateAsync(request);
      // The customer now has a real order line, so the board's own split
      // will keep them above the rule from here on and the staging entry has
      // done its job.
      setPromoted((current) => {
        if (!current.has(request.customerId)) return current;
        const next = new Set(current);
        next.delete(request.customerId);
        return next;
      });
      return true;
    } catch {
      return false;
    }
  };

  // The truck icon: submit_pick for a draft pick, revert_pick_to_draft for
  // a submitted one — the grower row's own current status decides which
  // RPC this call is, so the column never has to know about either
  // function by name. FORBIDDEN/INVALID_STATE get their own messages here
  // rather than reusing describeRpcError above: that one's copy ("הסידור
  // כבר סגור") is written for the arrangement-record functions and would
  // mislead for this pick-status action.
  const toggleSubmitOptimistic = optimisticUpdate<TradingDay | null, GrowerSupply>(
    queryClient,
    boardDataQueryKey,
    (current, grower) =>
      current
        ? {
            ...current,
            daily_picks: current.daily_picks.map((pick) =>
              pick.id === grower.pickId
                ? { ...pick, status: grower.status === "submitted" ? "draft" : "submitted" }
                : pick,
            ),
          }
        : current,
  );

  const toggleSubmitMutation = useMutation({
    mutationFn: async (grower: GrowerSupply) => {
      if (grower.status === "submitted") {
        const input = revertPickToDraftInputSchema.parse({ dailyPickId: grower.pickId });
        const { error } = await supabase.rpc(
          "revert_pick_to_draft",
          toRevertPickToDraftRpcArgs(input),
        );
        if (error) throw error;
      } else {
        const input = submitPickInputSchema.parse({ dailyPickId: grower.pickId });
        const { error } = await supabase.rpc("submit_pick", toSubmitPickRpcArgs(input));
        if (error) throw error;
      }
    },
    onMutate: toggleSubmitOptimistic.onMutate,
    onSuccess: (_data, grower) => {
      showToast(
        grower.status === "submitted" ? "הליקוט הוחזר לטיוטה." : "הליקוט נשלח.",
        "success",
      );
      void queryClient.invalidateQueries({ queryKey: boardDataQueryKey });
    },
    onError: mergeOnError(toggleSubmitOptimistic.onError, (error: RpcError) => {
      const message =
        error.code === LIFECYCLE_ERROR_CODES.INVALID_STATE
          ? "סטטוס הליקוט כבר השתנה בינתיים. רענן את הדף."
          : error.code === LIFECYCLE_ERROR_CODES.FORBIDDEN
            ? "אין הרשאה לבצע פעולה זו."
            : (error.message ?? "שגיאה לא ידועה");
      showToast(`העדכון נכשל: ${message}`, "error");
      void queryClient.invalidateQueries({ queryKey: boardDataQueryKey });
    }),
  });

  // Loading has two stages now: which day (dayView), then that day's board
  // (boardDataQuery, which only starts once a day id is known — see its
  // `enabled` above). Showing the skeleton through both keeps the screen
  // from flashing an empty-state between them on a slow connection.
  if (dayView.isLoading || (!!day && boardDataQuery.isLoading)) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // The board is the entire screen. A failed load previously rendered as
  // "there is no open trading day" plus an invitation to open one — which, on
  // a day that is in fact open, invites the distributor to try an action the
  // single-open-day index will then reject for reasons the screen just
  // contradicted.
  if (dayView.isError || boardDataQuery.isError) {
    return (
      <QueryError
        what="לוח הסידור"
        onRetry={() => {
          void dayView.refetch();
          void boardDataQuery.refetch();
        }}
        retrying={dayView.isFetching || boardDataQuery.isFetching}
      />
    );
  }

  if (!boardDay || !arrangement) {
    return (
      <div className="max-w-xl rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="clock"
          title={dayView.isLive ? "אין יום מסחר פתוח" : "לא נמצא יום מסחר בתאריך זה"}
          hint={
            dayView.isLive
              ? "פתח יום עסקים בסרגל הצד כדי לראות את היצע וביקוש היום ולסדר ביניהם."
              : "בחר תאריך אחר בסרגל הצד, או חזור ליום הפעיל."
          }
        />
      </div>
    );
  }

  const editable = dayView.isLive && arrangement.status === "open";
  // Any write in flight disables every other one. These all mutate the same
  // few pallets and the server's ceilings are checked per call, so letting
  // two overlap means the second is validated against a total the first has
  // already changed.
  const busy = arrangeMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="flex flex-col gap-6">
      {/* No header actions here any more. Both buttons that used to sit here
          duplicated controls that already live elsewhere: "+ סידור חדש"
          linked to /backoffice/new-arrangement, which is still reachable
          from the main backoffice nav (BackofficeNav's own "סידור לפי
          מוצרים" item); "סגור סידור" called the exact same close_arrangement RPC
          the sidebar's BusinessDayPanel already exposes as "סגירת יום
          עסקים" on every backoffice screen, this one included. Removing
          them here loses no capability — it removes a second button for an
          action that already has one. */}
      <PageHeader
        title="סידור"
        subtitle={new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(
          new Date(boardDay.trade_date),
        )}
        actions={
          // Only when the sidebar's picker has pinned a date away from the
          // live day — see shop.tsx for the same indicator and why it's
          // needed: nothing else on this screen distinguishes "today" from
          // "a past day that happens to render the same shape."
          !dayView.isLive ? (
            <StatusPill tone="warning">צפייה בעבר — לא ניתן לערוך</StatusPill>
          ) : undefined
        }
      />

      {/* Day phase and arrangement status are the two facts that decide
          whether "סגור סידור" is even available, so they get their own strip
          and their own semantics rather than being a grey run-on sentence
          under the title. */}
      <div className="animate-rise-in flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-surface px-5 py-4 shadow-card ring-1 ring-inset ring-border/70">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold tracking-[0.08em] text-ink-subtle">
            שלב יום
          </span>
          <StatusPill tone={boardDay.phase === "shop_closed" ? "warning" : "accent"} dot>
            {PHASE_LABEL[boardDay.phase]}
          </StatusPill>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold tracking-[0.08em] text-ink-subtle">
            סטטוס סידור
          </span>
          <StatusPill tone={editable ? "accent" : "neutral"} dot>
            {editable ? "פתוח" : "סגור"}
          </StatusPill>
        </div>
        {!editable && (
          <p className="text-xs text-ink-muted">הסידור נסגר — הרשומות מוצגות לקריאה בלבד.</p>
        )}
      </div>

      <ProductStrip
        product={selectedProduct}
        selected={selectedPickLine}
        onEditPrice={setPriceEditVarietyId}
      />

      {/* Growers first in source order, so in RTL they occupy the narrow
          inline-start column on the right and the customer cards take the
          wide remainder — the reference's own arrangement. Stacks to one
          column below `lg`, growers on top. */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <GrowerSupplyColumn
          growers={view.growers}
          selection={effectiveSelection}
          expandedId={expandedGrowerId}
          onToggle={(growerId) =>
            setExpandedGrowerId((current) => (current === growerId ? null : growerId))
          }
          onEditPick={setPickDialogGrower}
          onToggleSubmit={(grower) => toggleSubmitMutation.mutate(grower)}
          toggleSubmitDisabled={!editable || toggleSubmitMutation.isPending}
          onSelect={(next) => {
            setSelection(next);
            // The staging list is per-product: customers offered last
            // product's surplus have nothing to do with this one, and
            // leaving them above the rule would silently mis-file them.
            setPromoted(new Set());
          }}
        />

        <CustomerDemandBoard
          customers={view.customers}
          selection={effectiveSelection}
          selected={selectedPickLine}
          promoted={promoted}
          editable={editable}
          saving={busy}
          onPromote={(customerId) => setPromoted((current) => new Set(current).add(customerId))}
          onEditOrders={setOrdersCustomerId}
          onArrange={arrange}
          onSave={saveAllocation}
          onDelete={(recordId) => deleteMutation.mutate(recordId)}
        />
      </div>

      <ArrangementRecordsSection
        records={flatRecords}
        editable={editable}
        saving={busy}
        onSave={saveAllocation}
        onDelete={(recordId) => deleteMutation.mutate(recordId)}
      />

      <PriceEditDialog varietyId={priceEditVarietyId} onClose={() => setPriceEditVarietyId(null)} />

      <GrowerPickDialog
        pickId={pickDialogGrower?.pickId ?? null}
        pickStatus={pickDialogGrower?.status ?? "closed"}
        growerName={pickDialogGrower?.growerName ?? ""}
        onClose={() => setPickDialogGrower(null)}
        onSaved={() => {
          // Pallets picked is the supply half of every figure on this board
          // and the ceiling each ✓ is checked against, so the board has to
          // re-read before it starts validating against a stale number.
          void queryClient.invalidateQueries({ queryKey: ["arrangement", "board-data"] });
        }}
        // See PickLinesEditor's own `readOnly` comment for why this can't be
        // left to pickStatus alone.
        readOnly={!dayView.isLive}
      />

      <CustomerOrdersDialog
        tradingDayId={boardDay.id}
        customerId={ordersCustomerId}
        customerName={ordersCustomerName}
        onClose={() => setOrdersCustomerId(null)}
        onSubmitted={() => {
          // The order that was just saved is one of the two sides every
          // figure on this board is computed from, so the board has to
          // re-read before the popup's numbers and its own disagree.
          void queryClient.invalidateQueries({ queryKey: ["arrangement", "board-data"] });
          setOrdersCustomerId(null);
        }}
        // No status of its own to fall back on the way a pick has — see
        // OrderLinesEditor's `readOnly` comment.
        readOnly={!dayView.isLive}
      />
    </div>
  );
}

const PHASE_LABEL: Record<TradingDay["phase"], string> = {
  initiated: "פתיחת יום",
  shop_open: "חנות פתוחה",
  shop_closed: "חנות סגורה",
  closed: "סגור",
};

interface RpcError {
  code?: string;
  message?: string;
}

// The arrangement functions raise named SQLSTATEs (packages/domain's
// ARRANGEMENT_ERROR_CODES, from migration 0021). Raw Postgres messages were
// tolerable when every edit went through a deliberate "שמור" press on a
// table row; with quantities editable inline they are hit routinely — a
// rebalance that momentarily over-commits a pick line is a normal keystroke,
// not an exception — so the two codes a distributor can actually cause get
// said in the terms they were thinking in.
function describeRpcError(error: RpcError): string {
  switch (error.code) {
    case ARRANGEMENT_ERROR_CODES.OVER_ALLOCATION:
      return "הכמות חורגת ממה שנקטף בשורת הליקוט או ממה שהלקוח הזמין.";
    case ARRANGEMENT_ERROR_CODES.INVALID_STATE:
      return "הסידור כבר סגור.";
    case ARRANGEMENT_ERROR_CODES.NOT_FOUND:
      return "השורה או ההזמנה כבר לא קיימות. רענן את הדף.";
    // PostgREST's "no function matches" code. It is worth naming because
    // migrations here are applied by hand: the ✓ button calls
    // arrange_to_customer, which does not exist until 0040 is run, and the
    // raw message ("Could not find the function public.arrange_to_customer")
    // reads as a bug rather than as a pending migration.
    case "PGRST202":
      return "פעולה זו דורשת מיגרציה שטרם הורצה (0040). הרץ pnpm db:migrate.";
    default:
      return error.message ?? "שגיאה לא ידועה";
  }
}
