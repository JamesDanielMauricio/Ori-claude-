import { savePickLinesInputSchema, toSavePickLinesRpcArgs } from "@ori/domain/grower";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { inputClassName } from "@/components/reference-data/form-field";
import { Icon } from "@/components/ui/icon";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { hasChanges } from "@/lib/has-changes";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { createClient } from "@/lib/supabase/client";
import { formatVarietyName } from "@/lib/variety-label";

interface PickProductLineRow {
  id: string;
  pallets_picked: string;
  leftover_pallets: string;
  comment: string | null;
  product_varieties: {
    name: string;
    sizes: string | null;
    family_id: string;
    product_families: { name: string; image_url: string | null } | null;
  } | null;
}

interface DraftLine {
  id: string;
  pallets: string;
  leftover: string;
  comment: string;
}

function toDraftLines(rows: PickProductLineRow[]): DraftLine[] {
  return rows.map((row) => ({
    id: row.id,
    pallets: row.pallets_picked,
    leftover: row.leftover_pallets,
    comment: row.comment ?? "",
  }));
}

interface PickFamilyVariety {
  id: string;
  varietyName: string;
  pallets: string;
  leftover: string;
  comment: string;
}

interface PickFamilyGroup {
  familyId: string;
  familyName: string;
  imageUrl: string | null;
  varieties: PickFamilyVariety[];
}

// Joins the day's rows (family/variety identity, in the query's own order)
// with the draft (the values actually on screen) into the same
// family-grouped shape every other pick/order view in the app already
// renders — FamilyGroupedLines (the oversight screens' read view) and the
// arrangement board's grower column. This editor was the one place still
// showing a grower's picks as one flat list.
//
// Families are sorted by name for findability, same as those read views;
// varieties keep the query's own order within each family rather than a
// second, independent sort.
function groupDraftByFamily(rows: PickProductLineRow[], draft: DraftLine[]): PickFamilyGroup[] {
  const draftById = new Map(draft.map((line) => [line.id, line]));
  const families = new Map<string, PickFamilyGroup>();
  for (const row of rows) {
    const variety = row.product_varieties;
    if (!variety) continue;
    let group = families.get(variety.family_id);
    if (!group) {
      group = {
        familyId: variety.family_id,
        familyName: variety.product_families?.name ?? "",
        imageUrl: variety.product_families?.image_url ?? null,
        varieties: [],
      };
      families.set(variety.family_id, group);
    }
    const line = draftById.get(row.id);
    group.varieties.push({
      id: row.id,
      varietyName: formatVarietyName(variety.name, variety.sizes),
      pallets: line?.pallets ?? "",
      leftover: line?.leftover ?? "",
      comment: line?.comment ?? "",
    });
  }
  return [...families.values()].sort((a, b) => a.familyName.localeCompare(b.familyName, "he"));
}

// The draft as save_pick_lines would actually receive it. Used for both the
// save itself and the "is there anything to save?" comparison behind the
// ActionBar's buttons, so that question is answered by the payload rather
// than by the text in the inputs.
//
// That distinction is the whole point here. `pallets_picked` arrives from
// Postgres as a numeric string — "8.00" for a pick of 8 — so a grower who
// clears the field and retypes "8" has a draft that differs textually from
// the server while meaning exactly the same thing. Comparing the sent values
// (8 === 8) calls that unchanged, which it is. `productLabel` drops out for
// the same reason: it is display text this editor never saves.
function toSavedLines(lines: DraftLine[]) {
  return lines.map((line) => ({
    dailyPickProductId: line.id,
    palletsPicked: Number(line.pallets || 0),
    leftoverPallets: Number(line.leftover || 0),
    comment: line.comment || null,
  }));
}

// One of the row's two numeric columns (נקטף / עודף), with the caption that
// replaces the column header once the row stops being a four-column grid.
//
// The wrapper is `w-24` at EVERY size and the input fills it, so in the wide
// layout this renders at exactly the width a bare `w-24` input did — the
// column header above still lines up, pixel for pixel, and the desktop
// screen is unchanged. In the narrow layout the wrapper stacks its caption
// above the field.
//
// The caption is `aria-hidden` and the input keeps its own `aria-label`.
// Assistive tech is already told "פלטות שנקטפו — <variety>", which names the
// column AND the row; announcing a bare "נקטף" on top of that would be a
// second, vaguer name for the same field. The caption exists for the eye
// only, which is the sense that lost the information when the header hid.
function NumberCell({
  caption,
  ariaLabel,
  value,
  disabled,
  onChange,
}: {
  caption: string;
  ariaLabel: string;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex w-24 shrink-0 flex-col gap-1">
      <span aria-hidden className="text-[11px] font-medium text-ink-subtle @2xl:hidden">
        {caption}
      </span>
      <input
        type="number"
        min="0"
        step="0.01"
        disabled={disabled}
        aria-label={ariaLabel}
        className={`${inputClassName} w-full`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// The one place both the grower's own picking screen and the
// distributor's Grower Inventory Status oversight screen edit a Daily
// Pick's lines — same fields, same rules (save_pick_lines accepts "the
// owning grower, or backoffice"), so one component covers both instead of
// two near-identical copies (R1).
//
// Cancel-by-construction (the task's explicit requirement): `draft` is
// local component state, re-seeded from the query only while the user is
// not mid-edit (see the effect below for what "mid-edit" means). Typing in
// a field only ever calls `setDraft`; nothing touches the server until
// Save. Cancel re-seeds from the query — there is no server call to undo,
// so there is nothing to get wrong.
export function PickLinesEditor({
  dailyPickId,
  pickStatus,
  onSaved,
  sticky = false,
  readOnly = false,
}: {
  dailyPickId: string;
  pickStatus: "draft" | "submitted" | "closed";
  // Pins the ActionBar to the bottom of the scroll area instead of leaving
  // it wherever the line table happens to end. GrowerPickDialog needs it
  // because that dialog is a fixed-height scroll area; the grower's own
  // full-page screen needs it for the same reason the customer's order
  // screen does, and now passes it too.
  //
  // It used to be false there, on the reasoning that "the page itself
  // scrolls, so a bar pinned partway down it would float over content
  // instead of sitting at the bottom of anything". Floating over content IS
  // what a sticky bar does, and it is the point: measured on a phone, the
  // save button sat at y=2168 of a 2228px document with only thirteen
  // varieties expanded — about three and a half screens below a correction
  // made at the top, with nothing on the way down to confirm the edit was
  // still pending. A bar that is in flow only ever reaches the viewport
  // when the user has already scrolled past everything.
  sticky?: boolean;
  // Forces the same locked-down rendering `pickStatus === "closed"` gets
  // (inputs disabled, no ActionBar), independent of the pick's own status.
  // The backoffice oversight screens use this once the sidebar's date
  // picker (lib/trading-day-view.tsx) has pinned a day other than the live
  // one — including the one date this pick's own status can't catch on its
  // own: pinning the SAME date the live day already has. That reads as
  // "pinned" (not live) by the picker's own rules, yet the pick underneath
  // is still genuinely open, so `pickStatus` alone would say it's editable
  // when it must not be through this screen right now.
  readOnly?: boolean;
  // Fired after a successful save, for hosts that show this editor over
  // other data derived from the same pick — the arrangement board mounts it
  // in a popup and has to re-read the day's supply once pallets change.
  // Optional, so the two full-page hosts are unaffected; this component
  // still refreshes its own query either way. Mirrors OrderLinesEditor's
  // `onSubmitted`.
  onSaved?: () => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  // See the re-seeding effect below.
  const touched = useRef(false);
  // Collapsed by default — a grower's or a distributor's popup can list a
  // dozen families, and expanding all of them up front is a wall of inputs
  // before anyone has asked to edit any of it. Local UI state, not tied to
  // the draft/query: it survives a save or a refetch, only resetting when
  // this component itself unmounts (e.g. the oversight dialog closes).
  const [expandedFamilyIds, setExpandedFamilyIds] = useState<Set<string>>(new Set());

  function toggleFamily(familyId: string) {
    setExpandedFamilyIds((current) => {
      const next = new Set(current);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
  }

  const queryKey = ["grower", "pick-lines", dailyPickId];

  const linesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_pick_products")
        .select(
          "id, pallets_picked, leftover_pallets, comment, product_varieties(name, sizes, family_id, product_families(name, image_url))",
        )
        .eq("daily_pick_id", dailyPickId)
        .order("product_variety_id");
      if (error) throw error;
      return data as PickProductLineRow[];
    },
  });

  // Push-triggered refresh: the arrangement board (routes/backoffice/
  // arrangement.tsx) edits these same rows when a distributor works this
  // grower's card, and this editor also opens standalone on the grower's
  // own picking screen — either way, a save from elsewhere should show up
  // here without a manual refresh. Same trigger-only shape as
  // order-lines-editor.tsx; daily_pick_products is already in the realtime
  // publication (packages/db/migrations/0019_customer-catalog-realtime.sql).
  useEffect(() => {
    const channel = supabase
      .channel(`grower-pick-lines-${dailyPickId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_pick_products", filter: `daily_pick_id=eq.${dailyPickId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyPickId]);

  // Keeps the draft tracking the server without ever clobbering typing in
  // progress. The gate used to supply an idle state that was always safe to
  // re-seed from ("not editing"); with it gone, the first keystroke is what
  // marks the draft as the user's — seed freely until then, hold still after,
  // until the next save or discard resets `touched`.
  useEffect(() => {
    if (!linesQuery.data) return;
    if (touched.current) return;
    setDraft(toDraftLines(linesQuery.data));
  }, [linesQuery.data]);

  // ONE call, one transaction (R4). This previously built an array of up to two
  // RPCs per changed line and awaited them with Promise.all — each its own
  // transaction, so a failure partway through (a dropped connection, or the
  // P0006 already-arranged floor rejecting one line) committed some lines and
  // not others, then reported a single error over a half-written table with no
  // indication of which edits had survived. save_pick_lines (migration 0039)
  // takes the whole set and applies it all-or-nothing, so a rejected save now
  // leaves the database exactly matching the draft still on screen.
  //
  // Every line is sent with its full state rather than only the changed ones:
  // the function decides what actually changed by comparing against the stored
  // row, which is also what keeps its pick_updated notification tied to a real
  // quantity change instead of to whatever the client believed had changed.
  // The visible pallet/comment text is already the draft, live as the grower
  // types — nothing there waits on the network. What DOES currently wait is
  // `dirty` (below), which is derived by comparing the draft against
  // `linesQuery.data`: until the round trip lands and this cache refetches,
  // the ActionBar keeps showing "unsaved changes" even though Save was
  // already clicked. Patching the cache here with the draft's own values
  // resolves that the instant Save is pressed; a rejection rolls it back,
  // which reinstates `dirty` and re-enables Save/Discard exactly as if the
  // click had never landed.
  const saveOptimistic = optimisticUpdate<PickProductLineRow[], void>(
    queryClient,
    queryKey,
    (rows) => {
      if (!rows) return rows;
      const draftById = new Map(draft.map((line) => [line.id, line]));
      return rows.map((row) => {
        const line = draftById.get(row.id);
        return line
          ? {
              ...row,
              pallets_picked: line.pallets,
              leftover_pallets: line.leftover,
              comment: line.comment || null,
            }
          : row;
      });
    },
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = savePickLinesInputSchema.parse({
        dailyPickId,
        lines: toSavedLines(draft),
      });
      const { error } = await supabase.rpc("save_pick_lines", toSavePickLinesRpcArgs(input));
      if (error) throw error;
    },
    onMutate: saveOptimistic.onMutate,
    onSuccess: () => {
      showToast("השורות נשמרו.", "success");
      // The draft now matches the server, so let the refetch below re-seed
      // it — otherwise the editor would stay frozen on this draft for the
      // rest of its life and quietly stop showing other people's changes.
      touched.current = false;
      void queryClient.invalidateQueries({ queryKey });
      onSaved?.();
    },
    onError: mergeOnError(saveOptimistic.onError, (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    }),
  });

  function updateLine(id: string, patch: Partial<DraftLine>) {
    touched.current = true;
    setDraft((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  const families = useMemo(
    () => groupDraftByFamily(linesQuery.data ?? [], draft),
    [linesQuery.data, draft],
  );

  // The lines with no unsaved edits — what "בטל שינויים" puts back, and what
  // the draft is measured against to decide whether either button has
  // anything to do.
  const baselineLines = toDraftLines(linesQuery.data ?? []);
  const dirty = hasChanges(toSavedLines(draft), toSavedLines(baselineLines));

  function handleDiscard() {
    // Puts the fields back to what's stored, and nothing else — there is no
    // read-only mode for this button to drop into any more.
    setDraft(baselineLines);
    touched.current = false;
  }

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  const locked = pickStatus === "closed" || readOnly;

  if (linesQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // "This grower has no in-season products" is a real, actionable state
  // (someone has to fix their product list) — so it must not double as the
  // display for a failed fetch, which needs a retry instead.
  if (linesQuery.isError) {
    return (
      <QueryError
        what="שורות הליקוט"
        onRetry={() => void linesQuery.refetch()}
        retrying={linesQuery.isFetching}
      />
    );
  }

  if (!linesQuery.data || linesQuery.data.length === 0) {
    return <p className="text-sm text-ink-muted">אין מוצרים בעונה עבור מגדל זה.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {families.map((family) => {
          const expanded = expandedFamilyIds.has(family.familyId);
          return (
            <div
              key={family.familyId}
              // `@container`: the variety rows below switch between a
              // four-column grid and a stacked layout based on THIS card's
              // width, not the viewport's. They are not the same number.
              // The viewport gains a 256px sidebar at `md`, so a 768px
              // screen gives this card 448px while a 767px one gives it 727
              // — the content column gets narrower as the window gets wider,
              // and doesn't recover until ~1040px. A viewport breakpoint
              // cannot see that: `sm:` (640px) put the four-column layout on
              // a 448px card and squeezed the variety name to 28px, which
              // was worse on a tablet than on a phone. The same editor also
              // mounts inside GrowerPickDialog, where the viewport says
              // nothing at all about the space available.
              className="@container overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-inset ring-border/70"
            >
              <button
                type="button"
                onClick={() => toggleFamily(family.familyId)}
                aria-expanded={expanded}
                className={`group flex w-full items-center gap-2.5 bg-surface-muted/50 px-4 py-3 text-start transition-colors duration-200 hover:bg-surface-muted ${
                  expanded ? "border-b border-border/70" : ""
                }`}
              >
                <Icon
                  name="chevronDown"
                  className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
                    expanded ? "rotate-180 text-accent" : "text-ink-muted group-hover:text-accent"
                  }`}
                />
                <ProductThumbnail imageUrl={family.imageUrl} size="sm" />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                  {family.familyName}
                </p>
              </button>
              {/* Height-animated rather than mounted/unmounted (globals.css
                  `.accordion-panel`), and `inert` while collapsed so a closed
                  family's inputs stay out of the tab order — same pattern as
                  the arrangement board's grower rows (grower-supply-column.tsx). */}
              <div className="accordion-panel" data-open={expanded}>
                <div>
                  {/* Column header, per family rather than once for the
                      whole list: a header above the list can scroll out of
                      view long before a family further down gets opened,
                      leaving that family's own numbers unlabeled. Living
                      inside the panel it opens with means it's always right
                      there when the columns it names actually appear.
                      Reuses each row's own widths (w-24/w-24/w-40) so the
                      labels line up with their inputs.

                      Shown at exactly the size the row below IS a
                      four-column grid (`@2xl` = a 672px card — the row needs
                      96+96+160 of controls plus 36 of gaps, so anything
                      narrower leaves no readable name column and the row
                      stacks instead). That is now one condition expressed
                      once, rather than a header breakpoint guessing at a row
                      layout it could drift from.

                      It used to be `sm:flex`, and below 640px it simply
                      vanished with nothing in its place — which left a
                      grower on a phone looking at two identical unlabeled
                      number boxes per variety with no way to tell picked
                      from leftover. In the stacked layout the two numbers
                      now carry their own captions instead; see NumberCell. */}
                  <div className="hidden items-center gap-3 border-b border-border/60 px-4 py-1.5 text-xs font-medium text-ink-subtle @2xl:flex">
                    <span className="min-w-0 flex-1" />
                    <span className="w-24 text-center">נקטף</span>
                    <span className="w-24 text-center">עודף</span>
                    <span className="w-40 flex-1 @2xl:flex-none" />
                  </div>
                  <ul inert={!expanded}>
                    {family.varieties.map((variety) => (
                      <li
                        key={variety.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 last:border-b-0"
                      >
                        {/* `w-full` in the narrow layout takes a whole flex
                            line, which pushes the inputs down to their own
                            row. Measured at 375px, sharing the line left this
                            name 87px — and 32px at 320px, 28px on a 768px
                            tablet — so a variety like "עגבניה אשכולות L"
                            broke across three lines beside two full-width
                            number boxes. The inputs don't shrink (they carry
                            explicit widths), so the name was the only thing
                            that could absorb a narrow container, and it
                            absorbed all of it. At `@2xl` it goes back to
                            sharing the line, which is where the column header
                            above lines up. */}
                        <p className="w-full min-w-0 text-sm font-medium text-ink @2xl:w-auto @2xl:flex-1">
                          {variety.varietyName}
                        </p>
                        {/* The shared header above labels these two columns
                            (נקטף/עודף) — this input carries its own
                            aria-label too, so it's still identified on its
                            own for anyone not reading the header visually. */}
                        <NumberCell
                          caption="נקטף"
                          disabled={locked}
                          ariaLabel={`פלטות שנקטפו — ${variety.varietyName}`}
                          value={variety.pallets}
                          onChange={(next) => updateLine(variety.id, { pallets: next })}
                        />
                        {/* Carried forward from the grower's most recent prior
                            line for this variety (bootstrap_grower_pick /
                            sync_grower_picks, migration 0050) and
                            independently editable — kept as its own number,
                            not folded into "pallets", so a grower can see
                            which pallets are fresh vs. carried over and can
                            zero this out alone if it's gone bad. Counts as
                            real arrangeable supply either way: the save floor
                            (P0006) guards pallets + leftover combined, not
                            either field alone. */}
                        <NumberCell
                          caption="עודף"
                          disabled={locked}
                          ariaLabel={`פלטות עודף — ${variety.varietyName}`}
                          value={variety.leftover}
                          onChange={(next) => updateLine(variety.id, { leftover: next })}
                        />
                        <input
                          type="text"
                          disabled={locked}
                          placeholder="הערה"
                          aria-label={`הערה — ${variety.varietyName}`}
                          className={`${inputClassName} w-40 flex-1 @2xl:flex-none`}
                          value={variety.comment}
                          onChange={(event) =>
                            updateLine(variety.id, { comment: event.target.value })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!locked && (
        <ActionBar
          // Never false: this bar only renders when the pick is editable at
          // all, so the mode it would have switched to no longer exists. No
          // `onEdit` is passed for the same reason — see ActionBar's own
          // comment on that prop.
          editing
          saving={saving}
          dirty={dirty}
          canDelete={false}
          sticky={sticky}
          onDiscard={handleDiscard}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
