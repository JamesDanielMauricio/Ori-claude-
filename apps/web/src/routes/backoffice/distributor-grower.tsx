import {
  bootstrapGrowerPickInputSchema,
  sendPickReminderInputSchema,
  toBootstrapGrowerPickRpcArgs,
  toSendPickReminderRpcArgs,
} from "@ori/domain/grower";
import { saveGrowerInputSchema, toSaveGrowerRpcArgs } from "@ori/domain/reference-data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { formatPallets, formatPickupTime } from "@/components/arrangement/board-data";
import { GrowerPickDialog } from "@/components/arrangement/grower-pick-dialog";
import { CheckboxList } from "@/components/reference-data/checkbox-list";
import { ExpandableEntityRow } from "@/components/reference-data/expandable-entity-row";
import {
  FamilyGroupedLines,
  type FamilyGroupedRow,
} from "@/components/reference-data/family-grouped-lines";
import { TwoColumnRowList } from "@/components/reference-data/two-column-row-list";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/error-message";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { nudgeWhatsAppDispatch } from "@/lib/nudge-whatsapp-dispatch";
import { createClient } from "@/lib/supabase/client";
import { useTradingDayView } from "@/lib/trading-day-view";
import { formatVarietyName } from "@/lib/variety-label";

interface GrowerCompany {
  id: string;
  name: string;
  status: "active" | "inactive";
  default_pickup_time: string | null;
  whatsapp_group_id: string | null;
  transporter_company_id: string | null;
}

interface PickLineRow {
  id: string;
  pallets_picked: string;
  leftover_pallets: string;
  comment: string | null;
  product_varieties: {
    id: string;
    name: string;
    sizes: string | null;
    family_id: string;
    product_families: { id: string; name: string; image_url: string | null } | null;
  } | null;
}

interface DailyPickForDay {
  id: string;
  grower_company_id: string;
  status: "draft" | "submitted" | "closed";
  submitted_at: string | null;
  pickup_time: string | null;
  reminder_sent_at: string | null;
  daily_pick_products: PickLineRow[];
}

// One pick's lines, grouped by family — the read view an expanded row shows.
// Same shape the arrangement board's grower column derives (board-data.ts's
// GrowerFamilyGroup), rebuilt small here rather than imported: that one is
// entangled with allocation totals and a selection this screen has no use
// for, and pulling it in would mean carrying arrangement_records into a
// query that has nothing to do with them.
function groupPickLines(lines: PickLineRow[]): FamilyGroupedRow[] {
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
    const pallets = Number(line.pallets_picked) || 0;
    group.lines.push({
      id: line.id,
      varietyName: formatVarietyName(variety.name, variety.sizes),
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

// Distributor-facing "Grower Inventory Status" oversight (PRD:
// backoffice.md's "distributor+grower" tab — "Distributor as Grower View":
// a shared view used when the Distributor needs to act on a grower's
// behalf). One row per active grower — a status-colored name, an expand
// chevron revealing that grower's pick grouped by family (read-only), and
// two actions: a pencil that opens GrowerPickDialog — the exact same
// PickLinesEditor the grower's own screen and the arrangement board's
// pencil already use, since save_pick_lines already accepts "the owning
// grower, or backoffice" — and a bell that resends the pick reminder.
//
// Replaced a master-detail layout (pick a grower on the left, edit their
// pick on the right) with this flat, always-expandable list: the earlier
// shape made "who hasn't picked yet" a one-at-a-time question, answerable
// only by clicking through every grower in turn. Scanning name color down
// two columns answers it at a glance, and expanding is now a browse action
// separate from editing — editing was folded into a dialog instead of
// owning half the screen, matching the reference design.
export default function DistributorAsGrowerPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pickDialogGrower, setPickDialogGrower] = useState<{
    pickId: string;
    status: string;
    growerName: string;
  } | null>(null);
  const [productsDialogGrower, setProductsDialogGrower] = useState<GrowerCompany | null>(null);
  const [productDraft, setProductDraft] = useState<Set<string>>(new Set());
  const [savingProducts, setSavingProducts] = useState(false);

  // The day this oversight screen shows: the live open day by default, or —
  // once the sidebar's picker has pinned one (lib/trading-day-view.tsx) —
  // that specific date's day instead. `isLive` is what gates every write
  // control below; a pinned day is browse-only here regardless of its own
  // pick statuses, the same rule the arrangement board's popup follows.
  const dayView = useTradingDayView();
  const dayId = dayView.day?.id;

  const growersQuery = useQuery({
    queryKey: ["grower-oversight", "growers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, status, default_pickup_time, whatsapp_group_id, transporter_company_id")
        .eq("type", "grower")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as GrowerCompany[];
    },
  });

  // Picks AND their lines in one request — embedding daily_pick_products
  // rather than a second query per expanded row, so opening a tenth grower's
  // chevron costs nothing this screen hasn't already paid for the first.
  const picksForDayQueryKey = ["grower-oversight", "picks-for-day", dayId] as const;

  const picksForDayQuery = useQuery({
    queryKey: picksForDayQueryKey,
    enabled: !!dayId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_picks")
        .select(
          `id, grower_company_id, status, submitted_at, pickup_time, reminder_sent_at,
           daily_pick_products(id, pallets_picked, leftover_pallets, comment, product_varieties(id, name, sizes, family_id, product_families(id, name, image_url)))`,
        )
        .eq("trading_day_id", dayId!);
      if (error) throw error;
      return data as unknown as DailyPickForDay[];
    },
  });

  // Push-triggered refresh: a pick edited elsewhere (the grower's own
  // screen, the arrangement board's pencil) has to show up here without a
  // manual reload. Same trigger-only shape used throughout — payload
  // unread, only "re-run the query."
  useEffect(() => {
    if (!dayId) return;
    const channel = supabase
      .channel(`grower-oversight-picks-${dayId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_picks" }, () => {
        void queryClient.invalidateQueries({
          queryKey: ["grower-oversight", "picks-for-day", dayId],
        });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_pick_products" },
        () => {
          void queryClient.invalidateQueries({
            queryKey: ["grower-oversight", "picks-for-day", dayId],
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dayId, supabase, queryClient]);

  const pickByGrowerId = useMemo(() => {
    const map = new Map<string, DailyPickForDay>();
    for (const pick of picksForDayQuery.data ?? []) map.set(pick.grower_company_id, pick);
    return map;
  }, [picksForDayQuery.data]);

  const catalogQuery = useQuery({
    queryKey: ["grower-oversight", "product-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_varieties")
        .select("id, name, sizes, product_families(name)")
        .order("name");
      if (error) throw error;
      return data as Array<{
        id: string;
        name: string;
        sizes: string | null;
        product_families: { name: string } | null;
      }>;
    },
  });

  // Which growers have an in-season list at all — separate from
  // `pickByGrowerId` because "no pick yet today" is ambiguous on its own: it
  // covers both "hasn't picked yet" (initiate_business_day already
  // bootstrapped their pick, they just haven't filled it in) and "has no
  // products assigned, so initiate_business_day skipped them entirely" (see
  // migration 0049's `exists (select 1 from grower_products ...)` filter).
  // Only the second case needs a distributor to act somewhere other than the
  // pick editor, so it gets called out on the row instead of looking
  // identical to the first until the pencil is clicked.
  //
  // Paged (fetchAllRows) because grower_products is the table that outgrows
  // PostgREST's 1000-row cap, which truncates silently: past it, the growers
  // whose rows fell off the end would read as "no products in season" here.
  const growersWithProductsQuery = useQuery({
    queryKey: ["grower-oversight", "growers-with-products"],
    queryFn: async () => {
      const rows = await fetchAllRows<{ company_id: string }>((from, to) =>
        supabase
          .from("grower_products")
          .select("company_id")
          .order("company_id")
          .order("product_variety_id")
          .range(from, to),
      );
      return new Set(rows.map((row) => row.company_id));
    },
  });

  const growerProductsQuery = useQuery({
    queryKey: ["grower-oversight", "grower-products", productsDialogGrower?.id ?? null],
    enabled: !!productsDialogGrower,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grower_products")
        .select("product_variety_id")
        .eq("company_id", productsDialogGrower!.id);
      if (error) throw error;
      return data.map((row) => row.product_variety_id);
    },
  });

  // Seeded once per opening, from THIS grower's own list — and until that
  // has happened the dialog shows no checkboxes and "שמור" stays disabled.
  // save_grower replaces the grower's whole in-season list with whatever it
  // is sent, and `productDraft` otherwise still holds the previously opened
  // grower's selection while the new one loads (or forever, if the read
  // fails), so saving in that window would have written one grower's
  // products onto another. Seeding once, rather than on every change of the
  // query's data, also stops a background refetch from overwriting ticks the
  // distributor is in the middle of making.
  const [draftGrowerId, setDraftGrowerId] = useState<string | null>(null);
  useEffect(() => {
    if (!productsDialogGrower) {
      setDraftGrowerId(null);
      return;
    }
    if (!growerProductsQuery.data || draftGrowerId === productsDialogGrower.id) return;
    setProductDraft(new Set(growerProductsQuery.data));
    setDraftGrowerId(productsDialogGrower.id);
  }, [productsDialogGrower, growerProductsQuery.data, draftGrowerId]);
  const productDraftReady =
    productsDialogGrower !== null && draftGrowerId === productsDialogGrower.id;

  const catalogOptions = useMemo(
    () =>
      (catalogQuery.data ?? []).map((product) => ({
        id: product.id,
        label: product.product_families?.name
          ? `${product.product_families.name} — ${formatVarietyName(product.name, product.sizes)}`
          : formatVarietyName(product.name, product.sizes),
      })),
    [catalogQuery.data],
  );

  // Alphabetical once, here — both the single-column and two-column layouts
  // (TwoColumnRowList) read off this same order, so a column split never has
  // to re-derive it.
  const sortedGrowers = useMemo(() => {
    const rows = growersQuery.data ?? [];
    const needle = search.trim().toLocaleLowerCase("he");
    const filtered = needle
      ? rows.filter((row) => row.name.toLocaleLowerCase("he").includes(needle))
      : rows;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [growersQuery.data, search]);

  const saveProductsMutation = useMutation({
    mutationFn: async () => {
      const grower = productsDialogGrower;
      if (!grower) throw new Error("no grower selected");
      // Backstop behind the disabled button — see `draftGrowerId` above.
      if (draftGrowerId !== grower.id) throw new Error("רשימת המוצרים של המגדל עדיין לא נטענה");
      const saveInput = saveGrowerInputSchema.parse({
        id: grower.id,
        name: grower.name,
        status: grower.status,
        defaultPickupTime: grower.default_pickup_time,
        whatsappGroupId: grower.whatsapp_group_id,
        productVarietyIds: [...productDraft],
        // Preserved as-is — this dialog only edits in-season products;
        // save_grower replaces the whole row, so an unset value here
        // would silently wipe out an existing transporter assignment.
        transporterCompanyId: grower.transporter_company_id,
      });
      const { error: saveError } = await supabase.rpc(
        "save_grower",
        toSaveGrowerRpcArgs(saveInput),
      );
      if (saveError) throw saveError;

      if (dayId) {
        const bootstrapInput = bootstrapGrowerPickInputSchema.parse({
          tradingDayId: dayId,
          growerCompanyId: grower.id,
        });
        const { error: bootstrapError } = await supabase.rpc(
          "bootstrap_grower_pick",
          toBootstrapGrowerPickRpcArgs(bootstrapInput),
        );
        if (bootstrapError) throw bootstrapError;
      }
    },
    onSuccess: () => {
      showToast("רשימת המוצרים עודכנה.", "success");
      setProductsDialogGrower(null);
      void queryClient.invalidateQueries({ queryKey: ["grower-oversight", "grower-products"] });
      void queryClient.invalidateQueries({
        queryKey: ["grower-oversight", "growers-with-products"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["grower-oversight", "picks-for-day", dayId],
      });
    },
    onError: (error: { message?: string }) => {
      showToast(`העדכון נכשל: ${errorMessage(error)}`, "error");
    },
  });

  // One mutation, keyed per call by `dailyPickId` rather than by a single
  // "selected grower" — this screen has no selection any more, every row's
  // bell can fire independently. `variables` (react-query's own record of
  // what a pending call was invoked with) is what lets each row know
  // whether it, specifically, is the one currently sending.
  // `reminder_sent_at` is real, persisted state (not a fire-and-forget with
  // nothing to show for it) — patch it optimistically like any other field,
  // so the bell shows "sent" before the round trip rather than after it.
  const reminderOptimistic = optimisticUpdate<DailyPickForDay[], string>(
    queryClient,
    picksForDayQueryKey,
    (picks, dailyPickId) =>
      picks?.map((pick) =>
        pick.id === dailyPickId ? { ...pick, reminder_sent_at: new Date().toISOString() } : pick,
      ),
  );

  const reminderMutation = useMutation({
    mutationFn: async (dailyPickId: string) => {
      const input = sendPickReminderInputSchema.parse({ dailyPickId });
      const { error } = await supabase.rpc("send_pick_reminder", toSendPickReminderRpcArgs(input));
      if (error) throw error;
    },
    onMutate: reminderOptimistic.onMutate,
    onSuccess: () => {
      showToast("התזכורת נשלחה.", "success");
      void queryClient.invalidateQueries({ queryKey: picksForDayQueryKey });
      // The RPC above already queued the WhatsApp send durably — this just
      // asks the dispatcher to drain it right now instead of waiting for the
      // next scheduled run. See nudge-whatsapp-dispatch.ts for why this is
      // fire-and-forget and can never fail this mutation.
      nudgeWhatsAppDispatch(supabase);
    },
    onError: mergeOnError(reminderOptimistic.onError, (error: { message?: string }) => {
      showToast(`שליחת התזכורת נכשלה: ${errorMessage(error)}`, "error");
    }),
  });

  function toggleExpanded(growerId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (!next.delete(growerId)) next.add(growerId);
      return next;
    });
  }

  function toggleProduct(id: string) {
    setProductDraft((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSaveProducts() {
    setSavingProducts(true);
    saveProductsMutation.mutate(undefined, { onSettled: () => setSavingProducts(false) });
  }

  // The day comes first: until it's known, `dayId` is undefined and every
  // grower would briefly render as having no pick at all.
  const isLoading =
    dayView.isLoading ||
    growersQuery.isLoading ||
    (!!dayId && picksForDayQuery.isLoading) ||
    growersWithProductsQuery.isLoading;

  const rows = sortedGrowers.map((grower) => {
    const pick = pickByGrowerId.get(grower.id) ?? null;
    const hasProducts = growersWithProductsQuery.data?.has(grower.id) ?? true;
    // Green ("done") takes priority over everything else: submitted, or
    // closed outright, or the trading day itself already closed (which
    // closes every pick in bulk regardless of whether this grower ever
    // submitted — see migrations 0011/0013/0015/0022/0024's identical
    // `update daily_picks set status = 'closed' where trading_day_id = ...`,
    // and the case where the grower never had a pick at all). Checked
    // against the day's own `phase`, not `dayView.isLive`: a pinned past
    // date is "not live" but its phase could in principle be anything, so
    // phase is the only field that actually means "closed" (per James
    // 2026-09-15).
    //
    // Below that: orange means "carrying leftover stock" — real unsold
    // supply from a prior day (migration 0050's carry-forward) the
    // distributor still needs to account for while there's still time to.
    // No pick at all is neutral, not orange: the caption below already
    // explains that case in words, so it doesn't need the warmest color too.
    const dayClosed = dayView.day?.phase === "closed";
    const isDone = pick?.status === "submitted" || pick?.status === "closed" || dayClosed;
    const totalLeftover = pick
      ? pick.daily_pick_products.reduce((sum, line) => sum + (Number(line.leftover_pallets) || 0), 0)
      : 0;
    const tone = isDone ? "accent" : totalLeftover > 0 ? "warning" : "neutral";
    const statusCaption =
      pick?.status === "submitted" && pick.submitted_at
        ? `נשלח ב-${new Date(pick.submitted_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`
        : pick?.status === "closed"
          ? "סגור"
          : null;
    // Pickup time is per-grower, not per-product: the pick's own snapshot
    // once it has one (taken at submit/close, so it survives a later edit
    // to the company's default), otherwise the company's live default.
    const pickupTime = formatPickupTime(pick?.pickup_time ?? grower.default_pickup_time);
    // A grower with no pick AND no in-season products isn't "waiting to
    // pick" — they were never bootstrapped one, and won't be until someone
    // adds products for them (same action the pencil falls back to below).
    // Called out here so the row explains itself without opening anything.
    const caption =
      !pick && !hasProducts
        ? "אין מוצרים בעונה — יש להוסיף מוצרים"
        : [pickupTime && `איסוף ${pickupTime}`, statusCaption].filter(Boolean).join(" · ") || null;
    const families = pick ? groupPickLines(pick.daily_pick_products) : [];
    const reminding = reminderMutation.isPending && reminderMutation.variables === pick?.id;

    return (
      <ExpandableEntityRow
        key={grower.id}
        name={grower.name}
        tone={tone}
        caption={caption}
        expanded={expandedIds.has(grower.id)}
        onToggle={() => toggleExpanded(grower.id)}
        onEdit={() => {
          if (pick) {
            setPickDialogGrower({ pickId: pick.id, status: pick.status, growerName: grower.name });
          } else {
            // No pick exists yet for this grower today — nothing for
            // GrowerPickDialog to open. The products dialog is what
            // creates one (save_grower + bootstrap_grower_pick, exactly
            // the flow the old master-detail screen's "ערוך מוצרים בעונה"
            // button drove), so the pencil opens that instead.
            setProductsDialogGrower(grower);
          }
        }}
        editLabel={pick ? `ערוך את מלאי ${grower.name}` : `הוסף מוצרים בעונה עבור ${grower.name}`}
        onRemind={() => pick && reminderMutation.mutate(pick.id)}
        remindLabel={`שלח תזכורת ל${grower.name}`}
        remindDisabled={
          !dayView.isLive || !pick || pick.status === "closed" || reminderMutation.isPending
        }
        reminding={reminding}
      >
        <FamilyGroupedLines families={families} emptyLabel="אין מוצרים בעונה עבור מגדל זה." />
      </ExpandableEntityRow>
    );
  });

  return (
    <>
      <PageHeader
        title="בשם מגדל"
        subtitle="צפייה ועריכה של ליקוטי היום בשם כל מגדל, ושליחת תזכורות."
        actions={
          !dayView.isLive ? (
            <StatusPill tone="warning">צפייה בעבר — לא ניתן לערוך</StatusPill>
          ) : undefined
        }
      />

      <label className="relative mb-4 block max-w-xs">
        <span className="sr-only">חיפוש מגדל</span>
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
          placeholder="חיפוש מגדל…"
          className="h-10 w-full rounded-md bg-surface ps-9 pe-3 text-sm text-ink shadow-card ring-1 ring-inset ring-border-strong outline-none transition-colors duration-150 placeholder:text-ink-subtle focus:ring-2 focus:ring-accent/40"
        />
      </label>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : dayView.isLoadError ||
        growersQuery.isError ||
        picksForDayQuery.isError ||
        growersWithProductsQuery.isError ? (
        <QueryError
          what="מגדלים"
          onRetry={() => {
            void dayView.refetch();
            void growersQuery.refetch();
            void picksForDayQuery.refetch();
            void growersWithProductsQuery.refetch();
          }}
          retrying={
            dayView.isFetching ||
            growersQuery.isFetching ||
            picksForDayQuery.isFetching ||
            growersWithProductsQuery.isFetching
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="sprout"
          title="אין מגדלים להצגה"
          hint={search ? "נסה מונח חיפוש אחר." : "אין מגדלים פעילים במערכת."}
        />
      ) : (
        <TwoColumnRowList rows={rows} />
      )}

      <GrowerPickDialog
        pickId={pickDialogGrower?.pickId ?? null}
        pickStatus={pickDialogGrower?.status ?? "closed"}
        growerName={pickDialogGrower?.growerName ?? ""}
        onClose={() => setPickDialogGrower(null)}
        onSaved={() => {
          void queryClient.invalidateQueries({
            queryKey: ["grower-oversight", "picks-for-day", dayId],
          });
        }}
        readOnly={!dayView.isLive}
      />

      <Dialog
        open={productsDialogGrower !== null}
        onClose={() => setProductsDialogGrower(null)}
        title={
          productsDialogGrower ? `מוצרים בעונה — ${productsDialogGrower.name}` : "מוצרים בעונה"
        }
      >
        <div className="flex flex-col gap-4">
          {growerProductsQuery.isError ? (
            <QueryError
              what="המוצרים בעונה"
              onRetry={() => void growerProductsQuery.refetch()}
              retrying={growerProductsQuery.isFetching}
            />
          ) : productDraftReady ? (
            <CheckboxList
              options={catalogOptions}
              selectedIds={productDraft}
              onToggle={toggleProduct}
            />
          ) : (
            <p className="text-sm text-ink-muted">טוען…</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setProductsDialogGrower(null)}>
              ביטול
            </Button>
            <Button
              type="button"
              onClick={handleSaveProducts}
              disabled={savingProducts || !productDraftReady}
            >
              {savingProducts ? "שומר…" : "שמור"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
