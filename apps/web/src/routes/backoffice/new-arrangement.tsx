import {
  ARRANGEMENT_ERROR_CODES,
  arrangeToCustomerInputSchema,
  saveArrangementProposalInputSchema,
  toArrangeToCustomerRpcArgs,
  toDeleteArrangementRecordRpcArgs,
  toSaveArrangementProposalRpcArgs,
} from "@ori/domain/arrangement";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  ArrangementMatrix,
  type MatrixWrite,
} from "@/components/arrangement/arrangement-matrix";
import { ArrangementMatrixMobile } from "@/components/arrangement/arrangement-matrix-mobile";
import { learnFrom, proposeArrangement } from "@/components/arrangement/arrangement-engine";
import { dayToPropose } from "@/components/arrangement/arrangement-engine-input";
import { readEngineHistory } from "@/components/arrangement/arrangement-history-query";
import {
  lotOfPickLine,
  resolveProposal,
  saveRefusalMessage,
  setProposalCell,
  type ProposalLine,
} from "@/components/arrangement/arrangement-proposal";
import {
  formatPallets,
  type BoardCompany,
  type BoardOrder,
  type BoardPick,
  type BoardRecord,
} from "@/components/arrangement/board-data";
import {
  buildMatrix,
  filterMatrixRows,
  orderedOnly,
  type ProposedAllocation,
} from "@/components/arrangement/matrix-data";
import { Button } from "@/components/ui/button";
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

// One key for the save of a whole proposal, so "is one running?" can be asked
// of the mutation cache from any mount of this screen — see savingProposal.
const SAVE_PROPOSAL_KEY = ["new-arrangement", "save-proposal"] as const;

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
  // "הצג רק מוזמנים": the grid cut down to the products someone ordered and
  // the customers who ordered — see orderedOnly. Off on arrival: the whole
  // day is what this screen opens on, and stock nobody has asked for is
  // where a push comes from.
  const [onlyOrdered, setOnlyOrdered] = useState(false);
  // Which multi-grower products are open. Product ids, not row indices, so
  // the set survives a refetch reordering or a search narrowing the list.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // Same `lg` threshold the arrangement board and the reference-data
  // two-column layout already switch on — see lib/use-wide.ts. Below it,
  // ArrangementMatrixMobile replaces the frozen-pane spreadsheet with a
  // drill-down card list; the underlying `visible` data (below) is identical
  // either way.
  const wide = useWide("(min-width: 1024px)");
  // A suggestion on preview: offered, shown in the grid, corrected there by
  // the distributor (see commitCell), not saved. Held as lines — whose lot,
  // which product, which customer — rather than as the cells they land in,
  // and with the day it was offered for: so the cells are worked out afresh
  // from every read of that day (see `proposal` below), and a suggestion for
  // one day can never be shown, or saved, on another.
  const [suggestion, setSuggestion] = useState<{
    tradingDayId: string;
    lines: ProposalLine[];
    /** Lines the day had no room for when the suggestion was offered. */
    leftOut: number;
    /** What the last attempt to save it could not write, until the next one. */
    refusal: string | null;
  } | null>(null);
  // "הצע סידור" is reading the history and working the proposal out.
  const [proposing, setProposing] = useState(false);
  // Asked of the mutation cache, not of this component's own state: a save
  // outlives the screen that started it, and a distributor who leaves and
  // comes straight back must find the grid still held, not editable
  // underneath writes that are still landing.
  const savingProposal = useIsMutating({ mutationKey: SAVE_PROPOSAL_KEY }) > 0;

  // The day this grid shows: the live open day, or whatever the sidebar's
  // picker has pinned. Same resolution every date-aware backoffice screen
  // uses, sharing one query rather than each deciding for itself.
  const dayView = useTradingDayView();
  const day = dayView.day;

  // Everything else in ONE request once the day is known — see the identical
  // query on /backoffice/arrangement for why this is a single nested read
  // rather than a chain of dependent ones. Of `order_submission_logs`, which
  // that tree carries in full for its "changed since their last submission"
  // flag, this one takes only when each submission was made: the engine ranks
  // an earlier order first, and an order's time is its FIRST submission.
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
           daily_orders(id, customer_company_id, status, submitted_at, order_submission_logs(id, created_at), daily_order_products(id, daily_order_id, product_variety_id, pallets_ordered, comment, created_at, product_varieties(id, name, sizes, family_id, product_families(name, image_url))))`,
        )
        .eq("id", day!.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TradingDay | null;
    },
  });

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
  // Same rule as the board: a pinned past day is read-only regardless of its
  // phase, and a closed arrangement is read-only regardless of the picker.
  const editable = dayView.isLive && arrangement?.status === "open";

  // What of the suggestion is still unsaved, on the day as last read. Derived,
  // not stored: the day is re-read after a save and whenever anyone else
  // changes it (lib/live-updates.ts), and a cell has to drop out of the
  // preview the moment its record is there rather than be shown — and
  // counted — twice. Nothing is on preview on a day that cannot be edited.
  const proposal = useMemo(
    () =>
      suggestion && boardDay && editable && suggestion.tradingDayId === boardDay.id
        ? resolveProposal({
            lines: suggestion.lines,
            picks: boardDay.daily_picks,
            orders: boardDay.daily_orders,
            records: arrangement?.arrangement_records ?? [],
          })
        : null,
    [suggestion, boardDay, arrangement, editable],
  );

  // A suggestion is finished with once the day it was for is no longer the
  // one on screen, or that day can no longer be edited. Dropped here rather
  // than left in state, where it would come back to life the next time one of
  // those stopped being true. Not while it is being saved, though: the save
  // decides what becomes of it then. Tracked in render, not synced in an
  // effect, for the reason MatrixMobileInput gives: the stale preview never
  // paints.
  //
  // NOT when every cell of it has been emptied: the banner stays, with
  // nothing to save, so that the next number typed still goes into the
  // proposal — a preview that vanished under the distributor's hands would
  // turn their next keystroke into a write without a word.
  const forAnotherDay = suggestion?.tradingDayId !== day?.id;
  const noLongerEditable = boardDay?.id === suggestion?.tradingDayId && !editable;
  if (suggestion && !savingProposal && (forAnotherDay || noLongerEditable)) {
    setSuggestion(null);
  }

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
        proposal: proposal?.allocations ?? [],
      }),
    [boardDay, arrangement, companiesQuery.data, proposal],
  );

  // Filtering is separate from building for the same reason `markSelected` is
  // separate from `buildBoard` next door: a keystroke in the search box must
  // re-filter a list, not re-derive the day.
  //
  // Cut first, search second: which customers ordered is a fact about the
  // day, so the columns stay put while a product name is typed — and the cut
  // is not redone for every keystroke either.
  const shown = useMemo(() => (onlyOrdered ? orderedOnly(matrix) : matrix), [matrix, onlyOrdered]);
  const visible = useMemo(
    () => ({ columns: shown.columns, rows: filterMatrixRows(shown.rows, search) }),
    [shown, search],
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
   *
   * While a proposal is on preview, a cell with nothing saved in it is the
   * proposal's, and a number typed there is a correction to it — changed,
   * added or, when the box is emptied, taken out — that waits for "שמור
   * לסידור" with the rest. Nothing is written for it here. A cell that
   * already holds a saved allocation is never the proposal's (resolveProposal
   * lands nothing on one), so it is written at once, as it always is.
   */
  const commitCell = async (write: MatrixWrite): Promise<boolean> => {
    if (proposal && boardDay && !write.recordId) {
      const lot = lotOfPickLine(boardDay.daily_picks, write.pickLineId);
      if (!lot) return false;
      // From the lines as they stand when this is applied, not as they were
      // when the cell was drawn: two corrections in a row must both land.
      setSuggestion(
        (current) =>
          current && {
            ...current,
            lines: setProposalCell(
              current.lines,
              { ...lot, customerId: write.customerId },
              write.quantity,
            ),
          },
      );
      return true;
    }

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

  /**
   * The whole proposal on preview, saved in ONE call: save_arrangement_proposal
   * (migration 0068) writes every cell in one transaction, through the same
   * arrange_to_customer a typed cell uses, and only into cells still empty —
   * a refusal anywhere saves nothing, and a cell filled since the proposal was
   * read is refused, never overwritten.
   *
   * A mutation, like every other write in the app, because that is what
   * lib/live-updates.ts looks at: it will not re-read this device's screens
   * while one is in flight. The callbacks sit on the hook, not on the mutate()
   * call, so they still run if the screen is left mid-save.
   */
  const saveProposalMutation = useMutation({
    mutationKey: SAVE_PROPOSAL_KEY,
    mutationFn: async ({
      tradingDayId,
      allocations,
    }: {
      tradingDayId: string;
      allocations: ProposedAllocation[];
    }) => {
      const parsed = saveArrangementProposalInputSchema.parse({
        tradingDayId,
        allocations: allocations.map((allocation) => ({
          dailyPickProductId: allocation.pickLineId,
          customerCompanyId: allocation.customerId,
          quantityPallets: allocation.quantity,
        })),
      });
      const { data, error } = await supabase.rpc(
        "save_arrangement_proposal",
        toSaveArrangementProposalRpcArgs(parsed),
      );
      if (error) throw error;
      return data;
    },
    onSuccess: async (saved) => {
      // Re-read BEFORE the preview is let go, and wait for it — the mutation
      // stays pending meanwhile, so the grid stays held. Dropping the
      // suggestion first would show every cell just saved as empty for the
      // moment between the two.
      void queryClient.invalidateQueries({ queryKey: ["arrangement", "board-data"] });
      await queryClient.invalidateQueries({ queryKey: ["new-arrangement", "matrix"] });
      setSuggestion(null);
      showToast(`הסידור נשמר: ${saved} תאים.`, "success");
    },
    onError: async (error: RpcError) => {
      // Nothing was saved. Re-read anyway: a refusal usually means this
      // screen's copy of the day is behind — and a cell somebody filled
      // meanwhile drops out of the preview on that read by itself.
      void queryClient.invalidateQueries({ queryKey: ["arrangement", "board-data"] });
      await queryClient.invalidateQueries({ queryKey: ["new-arrangement", "matrix"] });
      const reason = describeSaveRefusal(error);
      // Kept on the banner: a toast is gone in four seconds, and the cells
      // it is about are still sitting in the grid to be corrected.
      setSuggestion((current) => current && { ...current, refusal: reason });
      showToast(reason, "error");
    },
  });

  /** Why a save was refused, naming the cells the refusal named. */
  function describeSaveRefusal(error: RpcError): string {
    return saveRefusalMessage({
      error,
      picks: boardDay?.daily_picks ?? [],
      names: new Map((companiesQuery.data ?? []).map((company) => [company.id, company.name])),
      reason: describeRpcError(error, "0068"),
    });
  }

  /**
   * "הצע סידור": works out a proposal for the day and puts it on preview.
   * Writes nothing.
   *
   * The day on screen as it stands — orders, what is free on each lot, what
   * is already arranged — plus the last HISTORY_DAYS days, read now; the rules
   * are arrangement-engine.ts's. Cells already arranged are never proposed
   * over.
   */
  const suggestArrangement = async () => {
    if (!boardDay || !arrangement || savingProposal || proposing) return;
    setProposing(true);
    try {
      const learnedFrom = await readEngineHistory(supabase, boardDay.trade_date);
      // The day as it stands NOW, not as it stood when the button was pressed:
      // the history read takes a moment, and anything saved meanwhile (it
      // re-reads the day through lib/live-updates.ts) must be worked around,
      // not proposed over.
      const today = queryClient.getQueryData<TradingDay | null>(boardDataQueryKey) ?? boardDay;
      const todaysArrangement = today.daily_arrangements;
      if (today.id !== boardDay.id || todaysArrangement?.status !== "open") return;
      // Today's products' families too: one first sold today is in no history.
      const familyOf = { ...learnedFrom.familyOf };
      for (const pick of today.daily_picks) {
        for (const line of pick.daily_pick_products) {
          if (line.product_varieties) {
            familyOf[line.product_varieties.id] = line.product_varieties.family_id;
          }
        }
      }
      const records = todaysArrangement.arrangement_records;
      // Marked as suggested: held to what is still on order every time the day
      // is read again while it is on preview (see resolveProposal).
      const lines = proposeArrangement({
        day: dayToPropose({
          tradeDate: today.trade_date,
          picks: today.daily_picks,
          orders: today.daily_orders,
          records,
        }),
        learned: learnFrom(learnedFrom.history, familyOf),
        familyOf,
        customers: learnedFrom.customers,
      }).map((line) => ({ ...line, suggested: true }));
      const offered = resolveProposal({
        lines,
        picks: today.daily_picks,
        orders: today.daily_orders,
        records,
      });
      if (offered.allocations.length === 0) {
        showToast("אין מה להציע: כל מה שהוזמן ויש לו מלאי כבר משובץ.");
        return;
      }
      setSuggestion({
        tradingDayId: boardDay.id,
        lines,
        leftOut: offered.alreadyArranged + offered.unplaceable + offered.noLongerOrdered,
        refusal: null,
      });
    } catch (error) {
      showToast(`חישוב הצעת הסידור נכשל: ${errorMessage(error)}`, "error");
    } finally {
      setProposing(false);
    }
  };

  // Set the moment a save is asked for, before the next render can show the
  // mutation as running: two clicks inside one frame would otherwise both get
  // through, and the second be refused for cells the first had just filled.
  const saveRequested = useRef(false);

  /** "שמור לסידור": saves what is on preview. */
  const saveSuggestion = () => {
    if (!proposal || !suggestion || savingProposal || saveRequested.current) return;
    if (proposal.allocations.length === 0) return;
    saveRequested.current = true;
    setSuggestion((current) => current && { ...current, refusal: null });
    saveProposalMutation.mutate(
      { tradingDayId: suggestion.tradingDayId, allocations: proposal.allocations },
      {
        onSettled: () => {
          saveRequested.current = false;
        },
      },
    );
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

  // A proposal on preview leaves the grid open: its numbers are there to be
  // corrected before they are saved, and which of a cell's numbers are not in
  // the database yet is told by how the box is drawn, not by locking it (see
  // commitCell for where a typed number goes meanwhile). A save of one that is
  // still running does hold every cell, whichever mount of this screen began
  // it: the cells are landing one by one, and a number typed over one of them
  // would race its own save.
  const gridEditable = editable && !savingProposal;
  const proposedPallets =
    proposal?.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) ?? 0;
  // Why the grid is empty, when the cut-down view is why: its own message
  // assumes a search that matched nothing.
  const emptyLabel =
    onlyOrdered && shown.rows.length === 0
      ? 'עדיין לא הוזמן דבר ביום זה. לחץ על "הצג הכול" כדי לחזור לכל המוצרים.'
      : onlyOrdered
        ? "אין מוצר מוזמן שמתאים לחיפוש."
        : null;

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
            {/* A save still landing with no preview above it: this screen was
                left mid-save and come back to. */}
            {savingProposal && !proposal && (
              <StatusPill tone="accent" dot>
                שומר הצעת סידור…
              </StatusPill>
            )}
            {/* Not while one is already open: asking again would replace the
                distributor's corrections with the suggestion they corrected. */}
            {gridEditable && !proposal && (
              <Button onClick={() => void suggestArrangement()} disabled={proposing}>
                {proposing ? "מחשב הצעה…" : "הצע סידור"}
              </Button>
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

      {/* A proposal on preview. Says what it is before it says what to do
          with it: the numbers it put in the grid look like any others at a
          glance, and nothing about them is in the database yet. */}
      {proposal && suggestion && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-accent-soft px-4 py-3 ring-1 ring-inset ring-accent/30"
        >
          <p className="text-sm text-ink">
            <span className="font-semibold">הצעת סידור — עדיין לא נשמרה.</span>{" "}
            {formatPallets(proposedPallets)} משטחים ב-{proposal.allocations.length} תאים.
            {suggestion.leftOut > 0 &&
              ` ${suggestion.leftOut} שורות לא נכללו: כבר משובצות, או שאין להן מקום ביום זה.`}
            {suggestion.refusal && (
              <span className="block font-semibold text-danger">{suggestion.refusal}</span>
            )}
          </p>
          <div className="ms-auto flex items-center gap-2">
            <Button
              onClick={saveSuggestion}
              disabled={savingProposal || proposal.allocations.length === 0}
            >
              {savingProposal ? "שומר…" : "שמור לסידור"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setSuggestion(null)}
              disabled={savingProposal}
            >
              בטל הצעה
            </Button>
          </div>
        </div>
      )}

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

        {/* A toggle, said as the thing pressing it will do. `aria-pressed`
            carries the state for a screen reader; the filled style carries it
            for everyone else. */}
        <Button
          variant={onlyOrdered ? "primary" : "secondary"}
          size="sm"
          aria-pressed={onlyOrdered}
          onClick={() => setOnlyOrdered((current) => !current)}
        >
          {onlyOrdered ? "הצג הכול" : "הצג רק מוזמנים"}
        </Button>

        <p className="text-xs text-ink-muted">
          {visible.rows.length} מוצרים · {visible.columns.length} לקוחות
        </p>

        {/* The two tints are the only things on the grid carrying meaning by
            colour alone, so each gets said in words rather than left to be
            inferred (the rule itself is matrix-data.ts's cellTone). */}
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <span
            aria-hidden
            className="h-3 w-3 rounded-sm bg-marked ring-1 ring-inset ring-marked-edge"
          />
          הוזמן וטרם שובץ
        </p>
        <p className="flex items-center gap-2 text-xs text-ink-muted">
          <span
            aria-hidden
            className="h-3 w-3 rounded-sm bg-arranged ring-1 ring-inset ring-arranged-edge"
          />
          שובץ
        </p>

        {proposal && (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <span
              aria-hidden
              className="h-3 w-3 rounded-sm border border-dashed border-accent bg-accent-soft"
            />
            מספר בתא כזה = הצעה שעדיין לא נשמרה
          </p>
        )}

        {/* The keyboard hint only describes the desktop grid's own arrow-key
            navigation — meaningless on the mobile card list below, which has
            no cell-to-cell navigation at all (see arrangement-matrix-mobile.tsx). */}
        {gridEditable && wide && (
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
          editable={gridEditable}
          onCommit={commitCell}
          {...(emptyLabel ? { emptyLabel } : {})}
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
          editable={gridEditable}
          onCommit={commitCell}
          {...(emptyLabel ? { emptyLabel } : {})}
        />
      )}
    </div>
  );
}

interface RpcError {
  code?: string;
  message?: string;
  /** PostgREST's copy of the error's DETAIL — where save_arrangement_proposal names the cell. */
  details?: string | null;
}

// The arrangement functions raise named SQLSTATEs (packages/domain's
// ARRANGEMENT_ERROR_CODES). Same translation the board does — kept as its own
// copy here rather than shared because the two screens can reasonably word
// the same refusal differently, and this one is typed into far faster: an
// over-allocation is a routine keystroke on a grid, not an exception.
function describeRpcError(error: RpcError, migration = "0040"): string {
  switch (error.code) {
    case ARRANGEMENT_ERROR_CODES.OVER_ALLOCATION:
      return "הכמות חורגת ממה שנקטף בשורת הליקוט או ממה שהלקוח הזמין.";
    case ARRANGEMENT_ERROR_CODES.INVALID_STATE:
      return "הסידור כבר סגור.";
    case ARRANGEMENT_ERROR_CODES.NOT_FOUND:
      return "השורה או ההזמנה כבר לא קיימות. רענן את הדף.";
    case ARRANGEMENT_ERROR_CODES.CONFLICT:
      return "התא כבר שובץ בינתיים.";
    case ARRANGEMENT_ERROR_CODES.INVALID_INPUT:
      return "חלק מהכמויות אינן תקינות.";
    // Postgres broke a lock cycle with another write landing at the same
    // moment (a grower's pick being saved, say) by giving up on this one.
    // Nothing was written; trying again is all it takes.
    case "40P01":
      return "השמירה התנגשה בשינוי אחר שנעשה באותו רגע. לא נשמר דבר — נסה שוב.";
    // PostgREST's "no function matches". Worth naming because migrations here
    // are applied by hand: every cell in this grid calls arrange_to_customer,
    // which does not exist until 0040 is run (and a whole proposal
    // save_arrangement_proposal, 0068), and the raw message reads as a bug
    // rather than as a pending migration.
    case "PGRST202":
      return `פעולה זו דורשת מיגרציה שטרם הורצה (${migration}). הרץ pnpm db:migrate.`;
    default:
      return errorMessage(error);
  }
}
