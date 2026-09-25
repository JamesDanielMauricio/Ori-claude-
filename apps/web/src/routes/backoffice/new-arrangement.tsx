import {
  ARRANGEMENT_ERROR_CODES,
  arrangeToCustomerInputSchema,
  toArrangeToCustomerRpcArgs,
  toDeleteArrangementRecordRpcArgs,
} from "@ori/domain/arrangement";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  ArrangementMatrix,
  type MatrixWrite,
} from "@/components/arrangement/arrangement-matrix";
import { ArrangementMatrixMobile } from "@/components/arrangement/arrangement-matrix-mobile";
import type {
  BoardCompany,
  BoardOrder,
  BoardPick,
  BoardRecord,
} from "@/components/arrangement/board-data";
import { buildMatrix, filterMatrixRows } from "@/components/arrangement/matrix-data";
import { StatusPill } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/error-message";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { useTradingDayView } from "@/lib/trading-day-view";
import { useWide } from "@/lib/use-wide";

// The whole screen's data as ONE nested row — same shape as the arrangement
// board's own query next door, and for the same reasons (see that file).
interface TradingDay {
  id: string;
  trade_date: string;
  phase: "initiated" | "shop_open" | "shop_closed" | "closed";
  daily_arrangements: DailyArrangement | null;
  daily_picks: BoardPick[];
  daily_orders: BoardOrder[];
}

interface DailyArrangement {
  id: string;
  status: "open" | "closed";
  arrangement_records: BoardRecord[];
}

// "סידור לפי מוצרים" — the day's whole arrangement as one spreadsheet:
// products down the side, customers across the top, and the pallets going
// from one to the other where they cross.
//
// This replaced a six-field wizard that built arrangement records one at a
// time (variety → grower → customer → quantity → price → save). The wizard
// was not wrong, it was just the wrong unit of work: a distributor settling a
// day is not creating a record, they are working across a customer's whole
// column or down a product's whole row, and doing that through a form meant
// re-selecting the variety and the grower for every single pallet decision.
// The matrix makes the same write — one arrangement record, one grower's lot
// to one customer — the cost of typing a number.
//
// Two row shapes, which is the part worth understanding before reading
// matrix-data.ts: a product supplied by ONE grower is typed into directly,
// while a product supplied by SEVERAL opens to reveal a row per grower and
// shows only a read-only sum itself. An arrangement record points at a
// specific daily_pick_products row, so "3 pallets of lemons" is not a
// writable fact until it says whose lemons.
//
// Every write is arrange_to_customer (migration 0040), the same idempotent
// RPC the arrangement board's ✓ uses: it upserts the record, and creates the
// customer's order line at zero pallets when they never ordered the product
// — which is what makes the un-highlighted cells in this grid writable at
// all. Emptying a cell is delete_arrangement_record instead.
export default function NewArrangementPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  // Which multi-grower products are open. Product ids, not row indices, so
  // the set survives a refetch reordering or a search narrowing the list.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Same `lg` threshold the arrangement board and the reference-data
  // two-column layout already switch on — see lib/use-wide.ts. Below it,
  // ArrangementMatrixMobile replaces the frozen-pane spreadsheet with a
  // drill-down card list; the underlying `visible` data (below) is identical
  // either way.
  const wide = useWide("(min-width: 1024px)");

  // The day this grid shows: the live open day, or whatever the sidebar's
  // picker has pinned. Same resolution every date-aware backoffice screen
  // uses, sharing one query rather than each deciding for itself.
  const dayView = useTradingDayView();
  const day = dayView.day;

  // Everything else in ONE request once the day is known — see the identical
  // query on /backoffice/arrangement for why this is a single nested read
  // rather than a chain of dependent ones. `order_submission_logs` is the one
  // thing that tree carries and this one does not: the "changed since their
  // last submission" flag it feeds has nowhere to go in a grid cell.
  const boardDataQueryKey = ["new-arrangement", "matrix", day?.id ?? null] as const;

  const boardDataQuery = useQuery({
    queryKey: boardDataQueryKey,
    enabled: !!day?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select(
          `id, trade_date, phase,
           daily_arrangements(id, status, arrangement_records(id, daily_pick_product_id, daily_order_product_id, customer_company_id, quantity_pallets, price, price_type)),
           daily_picks(id, grower_company_id, status, pickup_time, daily_pick_products(id, daily_pick_id, product_variety_id, pallets_picked, leftover_pallets, comment, product_varieties(id, name, sizes, family_id, product_families(name, image_url)))),
           daily_orders(id, customer_company_id, status, daily_order_products(id, daily_order_id, product_variety_id, pallets_ordered, comment, product_varieties(id, name, sizes, family_id, product_families(name, image_url))))`,
        )
        .eq("id", day!.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TradingDay | null;
    },
  });

  // Push-triggered refresh, same trigger-only shape as the arrangement
  // board's: the payload is never read, it only means "re-run the query".
  // This matters more here than there — two distributors can be typing into
  // different columns of the same grid, and each needs the other's pallets to
  // show up in the זמין column before they over-commit a lot.
  useEffect(() => {
    if (!day?.id) return;
    const dayId = day.id;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["new-arrangement", "matrix", dayId] });
    };

    const channel = supabase
      .channel(`arrangement-matrix-${dayId}`)
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

  // Whole-table reference data with no dependency on the day, so it starts
  // immediately and resolves in parallel instead of adding a round trip.
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

  // One derivation for the whole grid, memoised on the query results only —
  // so typing in a cell, expanding a row or searching does not re-total the
  // day. On a ~600-line day that pass is the one genuinely expensive thing
  // this screen does.
  const matrix = useMemo(
    () =>
      buildMatrix({
        picks: boardDay?.daily_picks ?? [],
        orders: boardDay?.daily_orders ?? [],
        records: arrangement?.arrangement_records ?? [],
        companies: companiesQuery.data ?? [],
      }),
    [boardDay, arrangement, companiesQuery.data],
  );

  // Filtering is separate from building for the same reason `markSelected` is
  // separate from `buildBoard` next door: a keystroke in the search box must
  // re-filter a list, not re-derive the day.
  const visible = useMemo(
    () => ({ columns: matrix.columns, rows: filterMatrixRows(matrix.rows, search) }),
    [matrix, search],
  );

  // Same "patch the one cached tree's records array" shape as the
  // arrangement board next door — buildMatrix's useMemo recomputes every
  // row/cell total (זמין, סה"כ חולק) from this array, so nothing here needs
  // to know how to total pallets.
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

  const arrangeOptimistic = recordsOptimistic<MatrixWrite>((records, write, current) => {
    if (write.recordId) {
      return records.map((record) =>
        record.id === write.recordId
          ? {
              ...record,
              quantity_pallets: write.quantity,
              price: write.price,
              price_type: write.priceType,
            }
          : record,
      );
    }
    // A brand-new record. Only constructible when the customer already has
    // an order line for this cell's variety — arrange_to_customer creates
    // that line itself otherwise, and its id isn't knowable client-side
    // before that happens; that case falls back to the existing
    // invalidate-on-settle refetch instead of being faked here.
    const varietyId = current.daily_picks
      .flatMap((pick) => pick.daily_pick_products)
      .find((line) => line.id === write.pickLineId)?.product_variety_id;
    const orderLineId = varietyId
      ? current.daily_orders
          .find((order) => order.customer_company_id === write.customerId)
          ?.daily_order_products.find((line) => line.product_variety_id === varietyId)?.id
      : undefined;
    if (!orderLineId) return records;
    return [
      ...records,
      {
        id: `optimistic-${crypto.randomUUID()}`,
        daily_pick_product_id: write.pickLineId,
        daily_order_product_id: orderLineId,
        customer_company_id: write.customerId,
        quantity_pallets: write.quantity,
        price: write.price,
        price_type: write.priceType,
      },
    ];
  });

  const arrangeMutation = useMutation({
    mutationFn: async (write: MatrixWrite) => {
      const parsed = arrangeToCustomerInputSchema.parse({
        dailyPickProductId: write.pickLineId,
        customerCompanyId: write.customerId,
        quantityPallets: write.quantity,
        // Handed back so the RPC has something to COALESCE onto an existing
        // record; null on a fresh one leaves pricing to close_arrangement,
        // exactly as the wizard this screen replaced did.
        price: write.price,
        priceType: write.priceType,
      });
      const { error } = await supabase.rpc(
        "arrange_to_customer",
        toArrangeToCustomerRpcArgs(parsed),
      );
      if (error) throw error;
    },
    onMutate: arrangeOptimistic.onMutate,
    onSuccess: invalidateBoards,
    onError: mergeOnError(arrangeOptimistic.onError, (error: RpcError) => {
      showToast(`שמירת הסידור נכשלה: ${describeRpcError(error)}`, "error");
      // Refetch on failure too: a refusal usually means this screen's copy of
      // the day is behind whatever caused it, so the grid should re-read
      // rather than argue with the server.
      invalidateBoards();
    }),
  });

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
    onSuccess: invalidateBoards,
    onError: mergeOnError(deleteOptimistic.onError, (error: RpcError) => {
      showToast(`מחיקת השיוך נכשלה: ${describeRpcError(error)}`, "error");
      invalidateBoards();
    }),
  });

  function invalidateBoards() {
    void queryClient.invalidateQueries({ queryKey: ["new-arrangement", "matrix"] });
    // The sibling board reads the same records out of its own cache entry,
    // so a cell typed here has to land there too.
    void queryClient.invalidateQueries({ queryKey: ["arrangement", "board-data"] });
  }

  /**
   * One cell, committed.
   *
   * Deliberately silent on success. Every other write in this app raises a
   * toast, but a distributor filling a row types across a dozen cells in a
   * few seconds and a dozen confirmations would bury the screen — and the
   * confirmation is already on screen anyway, in the זמין and סה״כ חולק
   * columns updating beside the number they just typed. Failures still toast,
   * because those are the ones with nothing else to show for them.
   *
   * Resolves to whether the write landed, never rejects: the grid puts the
   * cell back to the server's value on false.
   */
  const commitCell = async (write: MatrixWrite): Promise<boolean> => {
    try {
      if (write.quantity === 0) {
        // Clearing a cell that never had a record is not an error, it is a
        // distributor tabbing through an empty row.
        if (!write.recordId) return true;
        await deleteMutation.mutateAsync(write.recordId);
      } else {
        await arrangeMutation.mutateAsync(write);
      }
      return true;
    } catch {
      return false;
    }
  };

  // Two loading stages — which day, then that day's grid — held behind one
  // skeleton so a slow connection doesn't flash an empty state between them.
  if (dayView.isLoading || (!!day && boardDataQuery.isLoading)) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  // A failed load must not present itself as "no trading day is open" — that
  // invites the distributor to open a day that already exists.
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
              ? "פתח יום עסקים בסרגל הצד כדי לסדר את ליקוטי היום מול ההזמנות."
              : "בחר תאריך אחר בסרגל הצד, או חזור ליום הפעיל."
          }
        />
      </div>
    );
  }

  // Same rule as the board: a pinned past day is read-only regardless of its
  // phase, and a closed arrangement is read-only regardless of the picker.
  const editable = dayView.isLive && arrangement.status === "open";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="סידור לפי מוצרים"
        subtitle={new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(
          new Date(boardDay.trade_date),
        )}
        actions={
          <>
            {!editable && (
              <StatusPill tone="warning">
                {dayView.isLive ? "הסידור נסגר — קריאה בלבד" : "צפייה בעבר — לא ניתן לערוך"}
              </StatusPill>
            )}
            <Link
              to="/backoffice/arrangement"
              className="inline-flex h-10 items-center justify-center rounded-md bg-surface px-5 text-sm font-semibold text-ink shadow-card ring-1 ring-inset ring-border-strong transition-colors duration-200 hover:bg-surface-muted hover:text-accent hover:ring-accent/40"
            >
              לסידור לפי מגדל
            </Link>
          </>
        }
      />

      {/* The toolbar carries the one control the grid itself has no room for.
          A day can run to several hundred products, so search is how a
          distributor reaches a row at all — scrolling to it is not realistic. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="relative flex-1 sm:max-w-xs">
          <span className="sr-only">חיפוש מוצר</span>
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
            placeholder="חיפוש מוצר…"
            className="h-10 w-full rounded-md bg-surface ps-9 pe-3 text-sm text-ink shadow-card ring-1 ring-inset ring-border-strong outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:ring-2 focus:ring-accent/40"
          />
        </label>

        <p className="text-xs text-ink-muted">
          {visible.rows.length} מוצרים · {visible.columns.length} לקוחות
        </p>

        {/* The tint is the only thing on the grid carrying meaning by colour
            alone, so it gets said in words rather than left to be inferred. */}
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <span
            aria-hidden
            className="h-3 w-3 rounded-sm bg-marked ring-1 ring-inset ring-marked-edge"
          />
          תא מסומן = הלקוח הזמין את המוצר
        </p>

        {/* The keyboard hint only describes the desktop grid's own arrow-key
            navigation — meaningless on the mobile card list below, which has
            no cell-to-cell navigation at all (see arrangement-matrix-mobile.tsx). */}
        {editable && wide && (
          <p className="text-xs text-ink-subtle">
            הקלד כמות ולחץ Enter או Tab. חיצים לניווט בין תאים.
          </p>
        )}
      </div>

      {wide ? (
        <ArrangementMatrix
          matrix={visible}
          expanded={expanded}
          onToggle={(varietyId) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (!next.delete(varietyId)) next.add(varietyId);
              return next;
            })
          }
          editable={editable}
          onCommit={commitCell}
        />
      ) : (
        <ArrangementMatrixMobile
          matrix={visible}
          expanded={expanded}
          onToggle={(varietyId) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (!next.delete(varietyId)) next.add(varietyId);
              return next;
            })
          }
          editable={editable}
          onCommit={commitCell}
        />
      )}
    </div>
  );
}

interface RpcError {
  code?: string;
  message?: string;
}

// The arrangement functions raise named SQLSTATEs (packages/domain's
// ARRANGEMENT_ERROR_CODES). Same translation the board does — kept as its own
// copy here rather than shared because the two screens can reasonably word
// the same refusal differently, and this one is typed into far faster: an
// over-allocation is a routine keystroke on a grid, not an exception.
function describeRpcError(error: RpcError): string {
  switch (error.code) {
    case ARRANGEMENT_ERROR_CODES.OVER_ALLOCATION:
      return "הכמות חורגת ממה שנקטף בשורת הליקוט או ממה שהלקוח הזמין.";
    case ARRANGEMENT_ERROR_CODES.INVALID_STATE:
      return "הסידור כבר סגור.";
    case ARRANGEMENT_ERROR_CODES.NOT_FOUND:
      return "השורה או ההזמנה כבר לא קיימות. רענן את הדף.";
    // PostgREST's "no function matches". Worth naming because migrations here
    // are applied by hand: every cell in this grid calls arrange_to_customer,
    // which does not exist until 0040 is run, and the raw message reads as a
    // bug rather than as a pending migration.
    case "PGRST202":
      return "פעולה זו דורשת מיגרציה שטרם הורצה (0040). הרץ pnpm db:migrate.";
    default:
      return errorMessage(error);
  }
}
