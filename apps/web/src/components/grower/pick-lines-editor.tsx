import { savePickLinesInputSchema, toSavePickLinesRpcArgs } from "@ori/domain/grower";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { inputClassName } from "@/components/reference-data/form-field";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { hasChanges } from "@/lib/has-changes";
import { createClient } from "@/lib/supabase/client";

interface PickProductLineRow {
  id: string;
  pallets_picked: string;
  pickup_time: string | null;
  comment: string | null;
  product_varieties: {
    name: string;
    family_id: string;
    product_families: { name: string; image_url: string | null } | null;
  } | null;
}

interface DraftLine {
  id: string;
  pallets: string;
  pickupTime: string;
  comment: string;
}

function toDraftLines(rows: PickProductLineRow[]): DraftLine[] {
  return rows.map((row) => ({
    id: row.id,
    pallets: row.pallets_picked,
    pickupTime: row.pickup_time?.slice(0, 5) ?? "",
    comment: row.comment ?? "",
  }));
}

interface PickFamilyVariety {
  id: string;
  varietyName: string;
  pallets: string;
  pickupTime: string;
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
      varietyName: variety.name,
      pallets: line?.pallets ?? "",
      pickupTime: line?.pickupTime ?? "",
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
    pickupTime: line.pickupTime || null,
    comment: line.comment || null,
  }));
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
  // Pins the ActionBar to the bottom of GrowerPickDialog's popup instead of
  // wherever the line table happens to end — that dialog is a fixed-height
  // scroll area, so "שמור" sitting under the whole table was a scroll away
  // from where the distributor was actually looking. The grower's own
  // full-page screen leaves this false: the page itself scrolls, so a bar
  // pinned partway down it would float over content instead of sitting at
  // the bottom of anything. Same parameter OrderLinesEditor's ActionBar
  // takes, just not hardcoded true here — that editor is sticky on every
  // host, this one only on the one that's a popup.
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

  const queryKey = ["grower", "pick-lines", dailyPickId];

  const linesQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_pick_products")
        .select(
          "id, pallets_picked, pickup_time, comment, product_varieties(name, family_id, product_families(name, image_url))",
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
  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = savePickLinesInputSchema.parse({
        dailyPickId,
        lines: toSavedLines(draft),
      });
      const { error } = await supabase.rpc("save_pick_lines", toSavePickLinesRpcArgs(input));
      if (error) throw error;
    },
    onSuccess: () => {
      showToast("השורות נשמרו.", "success");
      // The draft now matches the server, so let the refetch below re-seed
      // it — otherwise the editor would stay frozen on this draft for the
      // rest of its life and quietly stop showing other people's changes.
      touched.current = false;
      void queryClient.invalidateQueries({ queryKey: ["grower", "pick-lines", dailyPickId] });
      onSaved?.();
    },
    onError: (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
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
        {families.map((family) => (
          <div
            key={family.familyId}
            className="overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-inset ring-border/70"
          >
            <div className="flex items-center gap-2.5 border-b border-border/70 bg-surface-muted/50 px-4 py-3">
              <ProductThumbnail imageUrl={family.imageUrl} size="sm" />
              <p className="font-display truncate text-base text-ink">{family.familyName}</p>
            </div>
            <ul>
              {family.varieties.map((variety) => (
                <li
                  key={variety.id}
                  className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0"
                >
                  <p className="min-w-0 flex-1 text-sm font-medium text-ink">{variety.varietyName}</p>
                  {/* No visible column labels — this used to be a table with
                      a header row, but that header made sense once, for a
                      flat list; repeated per family it would outweigh the
                      rows themselves. Each control still carries its own
                      aria-label, and the number/time inputs are legible from
                      their native browser affordances alone. */}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={locked}
                    aria-label={`פלטות שנקטפו — ${variety.varietyName}`}
                    className={`${inputClassName} w-24`}
                    value={variety.pallets}
                    onChange={(event) => updateLine(variety.id, { pallets: event.target.value })}
                  />
                  <input
                    type="time"
                    disabled={locked}
                    aria-label={`שעת איסוף — ${variety.varietyName}`}
                    className={`${inputClassName} w-32`}
                    value={variety.pickupTime}
                    onChange={(event) => updateLine(variety.id, { pickupTime: event.target.value })}
                  />
                  <input
                    type="text"
                    disabled={locked}
                    placeholder="הערה"
                    aria-label={`הערה — ${variety.varietyName}`}
                    className={`${inputClassName} w-40 flex-1 sm:flex-none`}
                    value={variety.comment}
                    onChange={(event) => updateLine(variety.id, { comment: event.target.value })}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
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
