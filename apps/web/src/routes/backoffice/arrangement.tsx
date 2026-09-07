import {
  toDeleteArrangementRecordRpcArgs,
  toUpdateArrangementRecordRpcArgs,
  updateArrangementRecordInputSchema,
} from "@ori/domain/arrangement";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { PriceEditDialog } from "@/components/arrangement/price-edit-dialog";
import { inputClassName } from "@/components/reference-data/form-field";
import { Button } from "@/components/ui/button";
import { Card, StatusPill } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

// The whole screen's data as ONE nested row — see BOARD_SELECT below for
// why this is a single shape rather than seven separate queries.
interface TradingDay {
  id: string;
  trade_date: string;
  phase: "initiated" | "shop_open" | "shop_closed" | "closed";
  // `unique(trading_day_id)` on daily_arrangements makes this a
  // one-to-one embed, so PostgREST returns an object here, not an array.
  daily_arrangements: DailyArrangement | null;
  daily_picks: PickHeader[];
  daily_orders: OrderHeader[];
}

interface DailyArrangement {
  id: string;
  status: "open" | "closed";
  arrangement_records: ArrangementRecord[];
}

interface PickHeader {
  id: string;
  grower_company_id: string;
  daily_pick_products: PickLine[];
}

interface PickLine {
  id: string;
  daily_pick_id: string;
  product_variety_id: string;
  pallets_picked: string;
  product_varieties: Variety | null;
}

interface OrderHeader {
  id: string;
  customer_company_id: string;
  daily_order_products: OrderLine[];
}

interface OrderLine {
  id: string;
  daily_order_id: string;
  product_variety_id: string;
  pallets_ordered: string;
  product_varieties: Variety | null;
}

interface Variety {
  id: string;
  name: string;
  family_id: string;
  product_families: { name: string } | null;
}

interface ArrangementRecord {
  id: string;
  daily_pick_product_id: string;
  daily_order_product_id: string;
  customer_company_id: string;
  quantity_pallets: number;
  price: number | null;
  price_type: string | null;
}

interface Company {
  id: string;
  name: string;
}

type ViewMode = "by-product" | "by-grower";

// The distributor's matchmaking workspace (PRD: arrangement-view.md).
// "By-grower" and "by-product" aren't two routes — the PRD's own ASCII
// sketch shows ONE screen with pooled supply/demand side by side and a
// single records table below; this page reads that same underlying data
// regardless of viewMode, only the records table's primary grouping
// changes (mirrors the customer catalog's "one function, two groupings"
// shape from Prompt 7). New records are created via /backoffice/new-arrangement
// (a separate focused wizard, per new-arrangement-wizard.md); this page
// edits/deletes existing ones and drives the terminal Close Arrangement
// transaction.
export default function ArrangementPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("by-product");
  const [priceEditVarietyId, setPriceEditVarietyId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // The whole screen in ONE request. Every table below hangs off the open
  // trading day by a foreign key, so PostgREST can return the entire tree
  // in a single round trip — the day, its arrangement + records, every
  // grower's pick and pick lines, every customer's order and order lines,
  // and each line's variety/family for labelling.
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
  // `companies` stays separate below: it's whole-table reference data with
  // no dependency on the day, so it starts immediately and resolves in
  // parallel rather than adding a hop.
  const boardQuery = useQuery({
    queryKey: ["arrangement", "board"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trading_days")
        .select(
          `id, trade_date, phase,
           daily_arrangements(id, status, arrangement_records(id, daily_pick_product_id, daily_order_product_id, customer_company_id, quantity_pallets, price, price_type)),
           daily_picks(id, grower_company_id, daily_pick_products(id, daily_pick_id, product_variety_id, pallets_picked, product_varieties(id, name, family_id, product_families(name)))),
           daily_orders(id, customer_company_id, daily_order_products(id, daily_order_id, product_variety_id, pallets_ordered, product_varieties(id, name, family_id, product_families(name))))`,
        )
        .neq("phase", "closed")
        .maybeSingle();
      if (error) throw error;
      // numeric columns come back as bare JSON numbers over PostgREST, not
      // decimal-preserving strings — see docs/SCHEMA_DECISIONS.md.
      return data as unknown as TradingDay | null;
    },
  });

  const day = boardQuery.data ?? null;
  const arrangement = day?.daily_arrangements ?? null;
  const records = useMemo(() => arrangement?.arrangement_records ?? [], [arrangement]);
  const picks = useMemo(() => day?.daily_picks ?? [], [day]);
  const orders = useMemo(() => day?.daily_orders ?? [], [day]);
  const pickLines = useMemo(() => picks.flatMap((pick) => pick.daily_pick_products), [picks]);
  const orderLines = useMemo(() => orders.flatMap((order) => order.daily_order_products), [orders]);

  const companiesQuery = useQuery({
    queryKey: ["arrangement", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .in("type", ["grower", "customer"]);
      if (error) throw error;
      return data as Company[];
    },
  });

  const companyNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const company of companiesQuery.data ?? []) map.set(company.id, company.name);
    return map;
  }, [companiesQuery.data]);

  // Varieties now ride along on the lines that reference them, so this is
  // a de-duplicating pass over data already in hand rather than a lookup
  // that has to wait for a request of its own.
  const varietyById = useMemo(() => {
    const map = new Map<string, Variety>();
    for (const line of pickLines)
      if (line.product_varieties) map.set(line.product_varieties.id, line.product_varieties);
    for (const line of orderLines)
      if (line.product_varieties) map.set(line.product_varieties.id, line.product_varieties);
    return map;
  }, [pickLines, orderLines]);

  const growerIdByPickId = useMemo(() => {
    const map = new Map<string, string>();
    for (const pick of picks) map.set(pick.id, pick.grower_company_id);
    return map;
  }, [picks]);

  const customerIdByOrderId = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of orders) map.set(order.id, order.customer_company_id);
    return map;
  }, [orders]);

  const pickLineById = useMemo(() => {
    const map = new Map<string, PickLine>();
    for (const line of pickLines) map.set(line.id, line);
    return map;
  }, [pickLines]);

  const orderLineById = useMemo(() => {
    const map = new Map<string, OrderLine>();
    for (const line of orderLines) map.set(line.id, line);
    return map;
  }, [orderLines]);

  // Pooled supply by variety, broken down by grower — the PRD's left-hand
  // column.
  const supplyByVariety = useMemo(() => {
    const groups = new Map<
      string,
      {
        varietyId: string;
        label: string;
        total: number;
        byGrower: Map<string, { name: string; pallets: number }>;
      }
    >();
    for (const line of pickLines) {
      const variety = varietyById.get(line.product_variety_id);
      const growerId = growerIdByPickId.get(line.daily_pick_id);
      if (!variety || !growerId) continue;
      const pallets = Number(line.pallets_picked);
      const label = variety.product_families?.name
        ? `${variety.product_families.name} — ${variety.name}`
        : variety.name;
      let group = groups.get(variety.id);
      if (!group) {
        group = { varietyId: variety.id, label, total: 0, byGrower: new Map() };
        groups.set(variety.id, group);
      }
      group.total += pallets;
      const growerName = companyNameById.get(growerId) ?? growerId;
      const existing = group.byGrower.get(growerId);
      group.byGrower.set(growerId, {
        name: growerName,
        pallets: (existing?.pallets ?? 0) + pallets,
      });
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [pickLines, varietyById, growerIdByPickId, companyNameById]);

  // Pooled demand by variety, broken down by customer — the PRD's
  // right-hand column.
  const demandByVariety = useMemo(() => {
    const groups = new Map<
      string,
      {
        varietyId: string;
        label: string;
        total: number;
        byCustomer: Map<string, { name: string; pallets: number }>;
      }
    >();
    for (const line of orderLines) {
      const variety = varietyById.get(line.product_variety_id);
      const customerId = customerIdByOrderId.get(line.daily_order_id);
      if (!variety || !customerId) continue;
      const pallets = Number(line.pallets_ordered);
      const label = variety.product_families?.name
        ? `${variety.product_families.name} — ${variety.name}`
        : variety.name;
      let group = groups.get(variety.id);
      if (!group) {
        group = { varietyId: variety.id, label, total: 0, byCustomer: new Map() };
        groups.set(variety.id, group);
      }
      group.total += pallets;
      const customerName = companyNameById.get(customerId) ?? customerId;
      const existing = group.byCustomer.get(customerId);
      group.byCustomer.set(customerId, {
        name: customerName,
        pallets: (existing?.pallets ?? 0) + pallets,
      });
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [orderLines, varietyById, customerIdByOrderId, companyNameById]);

  // Out-of-stock: total demand exceeds total supply for the variety (PRD's
  // ◯◯◯ OOS indicator).
  const outOfStockVarietyIds = useMemo(() => {
    const supplyTotal = new Map(supplyByVariety.map((group) => [group.varietyId, group.total]));
    const ids = new Set<string>();
    for (const demand of demandByVariety) {
      if (demand.total > (supplyTotal.get(demand.varietyId) ?? 0)) ids.add(demand.varietyId);
    }
    return ids;
  }, [supplyByVariety, demandByVariety]);

  // Arrangement records, resolved to display fields and grouped by the
  // active view mode — same records, same joins, just a different primary
  // sort key (R6: one function, two groupings, not two data models).
  const recordRows = useMemo(() => {
    return records
      .map((record) => {
        const pickLine = pickLineById.get(record.daily_pick_product_id);
        const orderLine = orderLineById.get(record.daily_order_product_id);
        const variety = pickLine ? varietyById.get(pickLine.product_variety_id) : undefined;
        const growerId = pickLine ? growerIdByPickId.get(pickLine.daily_pick_id) : undefined;
        return {
          record,
          varietyLabel: variety
            ? variety.product_families?.name
              ? `${variety.product_families.name} — ${variety.name}`
              : variety.name
            : "—",
          growerName: growerId ? (companyNameById.get(growerId) ?? growerId) : "—",
          customerName:
            companyNameById.get(record.customer_company_id) ?? record.customer_company_id,
          pickLine,
          orderLine,
        };
      })
      .sort((a, b) => {
        const primary =
          viewMode === "by-grower"
            ? a.growerName.localeCompare(b.growerName)
            : a.varietyLabel.localeCompare(b.varietyLabel);
        if (primary !== 0) return primary;
        return viewMode === "by-grower"
          ? a.varietyLabel.localeCompare(b.varietyLabel)
          : a.growerName.localeCompare(b.growerName);
      });
  }, [
    records,
    pickLineById,
    orderLineById,
    varietyById,
    growerIdByPickId,
    companyNameById,
    viewMode,
  ]);

  const deleteMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase.rpc(
        "delete_arrangement_record",
        toDeleteArrangementRecordRpcArgs({ id: recordId }),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("הרשומה נמחקה.", "success");
      // Records are nested inside the board query's single response now,
      // so refetching the board is what picks up the change.
      void queryClient.invalidateQueries({ queryKey: ["arrangement", "board"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`המחיקה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      id: string;
      quantityPallets: number;
      price: number | null;
      priceType: string | null;
    }) => {
      const parsed = updateArrangementRecordInputSchema.parse(input);
      const { error } = await supabase.rpc(
        "update_arrangement_record",
        toUpdateArrangementRecordRpcArgs(parsed),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("הרשומה עודכנה.", "success");
      void queryClient.invalidateQueries({ queryKey: ["arrangement", "board"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`העדכון נכשל: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_arrangement");
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("הסידור נסגר.", "success");
      void queryClient.invalidateQueries({ queryKey: ["arrangement"] });
    },
    onError: (error: { message?: string }) => {
      showToast(`סגירת הסידור נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  const isLoading = boardQuery.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!day || !arrangement) {
    return (
      <div className="max-w-xl rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="clock"
          title="אין יום מסחר פתוח"
          hint="פתח יום עסקים בסרגל הצד כדי לראות את היצע וביקוש היום ולסדר ביניהם."
        />
      </div>
    );
  }

  const canClose = day.phase === "shop_closed" && arrangement.status === "open";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="סידור"
        subtitle={new Intl.DateTimeFormat("he-IL", { dateStyle: "long" }).format(
          new Date(day.trade_date),
        )}
        actions={
          <>
            <Link to="/backoffice/new-arrangement">
              <Button type="button" variant="secondary">
                + סידור חדש
              </Button>
            </Link>
            <Button
              type="button"
              disabled={!canClose || closing}
              onClick={() => {
                setClosing(true);
                closeMutation.mutate(undefined, { onSettled: () => setClosing(false) });
              }}
            >
              {closing ? "סוגר…" : "סגור סידור ←"}
            </Button>
          </>
        }
      />

      {/* Day phase and arrangement status were a grey run-on sentence under
          the title. They are the two facts that decide whether "סגור סידור"
          is even available, so they get their own strip and their own
          semantics. */}
      <div className="animate-rise-in flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-surface px-5 py-4 shadow-card ring-1 ring-inset ring-border/70">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">
            שלב יום
          </span>
          <StatusPill tone={day.phase === "shop_closed" ? "brass" : "accent"} dot>
            {PHASE_LABEL[day.phase]}
          </StatusPill>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-subtle">
            סטטוס סידור
          </span>
          <StatusPill tone={arrangement.status === "open" ? "accent" : "neutral"} dot>
            {arrangement.status === "open" ? "פתוח" : "סגור"}
          </StatusPill>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="היצע מאוגד" padded={false}>
          {supplyByVariety.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">אין היצע רשום עדיין.</p>
          ) : (
            <ul>
              {supplyByVariety.map((group) => (
                <li
                  key={group.varietyId}
                  className="border-b border-border px-5 py-4 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{group.label}</p>
                      {outOfStockVarietyIds.has(group.varietyId) && (
                        <span className="mt-1.5 inline-block">
                          <StatusPill tone="danger">חוסר במלאי</StatusPill>
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* The total is the number being scanned down this
                          column, so it is set as a numeral, not buried
                          mid-sentence after an em dash. */}
                      <p className="text-end" dir="ltr">
                        <span className="font-display text-xl leading-none text-ink">
                          {group.total}
                        </span>
                        <span className="ms-1 text-xs text-ink-subtle">משטחים</span>
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPriceEditVarietyId(group.varietyId)}
                      >
                        ערוך מחיר
                      </Button>
                    </div>
                  </div>
                  <ul className="mt-2.5 flex flex-col gap-1 border-t border-border/60 pt-2.5">
                    {[...group.byGrower.values()].map((g, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate text-ink-muted">{g.name}</span>
                        <span className="shrink-0 tabular-nums text-ink">{g.pallets}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="ביקוש מאוגד" padded={false}>
          {demandByVariety.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">אין ביקוש רשום עדיין.</p>
          ) : (
            <ul>
              {demandByVariety.map((group) => (
                <li
                  key={group.varietyId}
                  className="border-b border-border px-5 py-4 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{group.label}</p>
                      {outOfStockVarietyIds.has(group.varietyId) && (
                        <span className="mt-1.5 inline-block">
                          <StatusPill tone="danger">חוסר במלאי</StatusPill>
                        </span>
                      )}
                    </div>
                    <p className="shrink-0 text-end" dir="ltr">
                      <span className="font-display text-xl leading-none text-ink">
                        {group.total}
                      </span>
                      <span className="ms-1 text-xs text-ink-subtle">משטחים</span>
                    </p>
                  </div>
                  <ul className="mt-2.5 flex flex-col gap-1 border-t border-border/60 pt-2.5">
                    {[...group.byCustomer.values()].map((c, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="truncate text-ink-muted">{c.name}</span>
                        <span className="shrink-0 tabular-nums text-ink">{c.pallets}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl text-ink">רשומות סידור</h2>
          {/* A real segmented control: one track, one moving selection —
              rather than two buttons where the inactive one was a ghost and
              the pair read as "a button and some text". */}
          <div
            role="group"
            aria-label="תצוגת רשומות"
            className="inline-flex gap-1 rounded-lg bg-surface-muted p-1 ring-1 ring-inset ring-border"
          >
            {(
              [
                ["by-product", "לפי מוצר"],
                ["by-grower", "לפי מגדל"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                  viewMode === mode
                    ? "bg-surface text-ink shadow-card"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <TableContainer>
          <TableHeader>
            <TableRow>
              <TableHead>זן</TableHead>
              <TableHead>מגדל</TableHead>
              <TableHead>לקוח</TableHead>
              <TableHead>כמות</TableHead>
              <TableHead>מחיר</TableHead>
              <TableHead>סוג תמחור</TableHead>
              <TableHead>פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recordRows.map((row) => (
              <ArrangementRecordRow
                key={row.record.id}
                varietyLabel={row.varietyLabel}
                growerName={row.growerName}
                customerName={row.customerName}
                record={row.record}
                editable={arrangement.status === "open"}
                onSave={(patch) => updateMutation.mutate({ id: row.record.id, ...patch })}
                onDelete={() => deleteMutation.mutate(row.record.id)}
                saving={updateMutation.isPending}
              />
            ))}
            {recordRows.length === 0 && (
              <TableRow>
                <TableCell className="text-ink-muted" colSpan={7}>
                  אין רשומות סידור עדיין.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </TableContainer>
      </div>

      <PriceEditDialog varietyId={priceEditVarietyId} onClose={() => setPriceEditVarietyId(null)} />
    </div>
  );
}

const PHASE_LABEL: Record<TradingDay["phase"], string> = {
  initiated: "פתיחת יום",
  shop_open: "חנות פתוחה",
  shop_closed: "חנות סגורה",
  closed: "סגור",
};

function ArrangementRecordRow({
  varietyLabel,
  growerName,
  customerName,
  record,
  editable,
  saving,
  onSave,
  onDelete,
}: {
  varietyLabel: string;
  growerName: string;
  customerName: string;
  record: ArrangementRecord;
  editable: boolean;
  saving: boolean;
  onSave: (patch: {
    quantityPallets: number;
    price: number | null;
    priceType: string | null;
  }) => void;
  onDelete: () => void;
}) {
  const [quantity, setQuantity] = useState(String(record.quantity_pallets));
  const [price, setPrice] = useState(record.price === null ? "" : String(record.price));
  const [priceType, setPriceType] = useState(record.price_type ?? "");

  return (
    <TableRow>
      <TableCell>{varietyLabel}</TableCell>
      <TableCell>{growerName}</TableCell>
      <TableCell>{customerName}</TableCell>
      <TableCell>
        <input
          type="number"
          step="0.01"
          min={0}
          disabled={!editable}
          className={`${inputClassName} w-24`}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <input
          type="number"
          step="0.01"
          min={0}
          disabled={!editable}
          className={`${inputClassName} w-24`}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <input
          disabled={!editable}
          className={`${inputClassName} w-24`}
          value={priceType}
          onChange={(event) => setPriceType(event.target.value)}
        />
      </TableCell>
      <TableCell>
        {editable && (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() =>
                onSave({
                  quantityPallets: Number(quantity),
                  price: price === "" ? null : Number(price),
                  priceType: priceType || null,
                })
              }
            >
              שמור
            </Button>
            <Button type="button" variant="danger" disabled={saving} onClick={onDelete}>
              מחק
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
