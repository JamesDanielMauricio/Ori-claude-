"use client";

import {
  toUpdatePickProductDetailsRpcArgs,
  updatePickProductDetailsInputSchema,
} from "@ori/domain/grower";
import { toUpdatePickProductPalletsRpcArgs, updatePickProductPalletsInputSchema } from "@ori/domain/lifecycle-engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ActionBar } from "@/components/reference-data/action-bar";
import { inputClassName } from "@/components/reference-data/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";

interface PickProductLineRow {
  id: string;
  pallets_picked: string;
  pickup_time: string | null;
  comment: string | null;
  product_varieties: { name: string; product_families: { name: string } | null } | null;
}

interface DraftLine {
  id: string;
  productLabel: string;
  pallets: string;
  pickupTime: string;
  comment: string;
}

function productLabel(row: PickProductLineRow): string {
  const variety = row.product_varieties;
  if (!variety) return "";
  return variety.product_families?.name ? `${variety.product_families.name} — ${variety.name}` : variety.name;
}

function toDraftLines(rows: PickProductLineRow[]): DraftLine[] {
  return rows.map((row) => ({
    id: row.id,
    productLabel: productLabel(row),
    pallets: row.pallets_picked,
    pickupTime: row.pickup_time?.slice(0, 5) ?? "",
    comment: row.comment ?? "",
  }));
}

// The one place both the grower's own picking screen and the
// distributor's Grower Inventory Status oversight screen edit a Daily
// Pick's lines — same fields, same rules (update_pick_product_pallets
// and update_pick_product_details both accept "the owning grower, or
// backoffice"), so one component covers both instead of two
// near-identical copies (R1).
//
// Cancel-by-construction (the task's explicit requirement): `draft` is
// local component state, only ever written to from `rows` while
// `!editing`. Typing in a field only ever calls `setDraft`; nothing
// touches the server until Save. Cancel calls `syncDraftFromRows()` and
// flips `editing` off — there is no server call to undo, so there is
// nothing to get wrong.
export function PickLinesEditor({
  dailyPickId,
  pickStatus,
}: {
  dailyPickId: string;
  pickStatus: "draft" | "submitted" | "closed";
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftLine[]>([]);

  const linesQuery = useQuery({
    queryKey: ["grower", "pick-lines", dailyPickId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_pick_products")
        .select("id, pallets_picked, pickup_time, comment, product_varieties(name, product_families(name))")
        .eq("daily_pick_id", dailyPickId)
        .order("product_variety_id");
      if (error) throw error;
      return data as PickProductLineRow[];
    },
  });

  useEffect(() => {
    if (!editing && linesQuery.data) {
      setDraft(toDraftLines(linesQuery.data));
    }
  }, [linesQuery.data, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const originalById = new Map((linesQuery.data ?? []).map((row) => [row.id, row]));
      const calls: Array<PromiseLike<unknown>> = [];

      for (const line of draft) {
        const original = originalById.get(line.id);
        if (!original) continue;

        if (line.pallets !== original.pallets_picked) {
          const input = updatePickProductPalletsInputSchema.parse({
            dailyPickProductId: line.id,
            palletsPicked: Number(line.pallets),
          });
          calls.push(
            supabase.rpc("update_pick_product_pallets", toUpdatePickProductPalletsRpcArgs(input)).then((result) => {
              if (result.error) throw result.error;
            }),
          );
        }

        const originalPickupTime = original.pickup_time?.slice(0, 5) ?? "";
        const originalComment = original.comment ?? "";
        if (line.pickupTime !== originalPickupTime || line.comment !== originalComment) {
          const input = updatePickProductDetailsInputSchema.parse({
            dailyPickProductId: line.id,
            pickupTime: line.pickupTime || null,
            comment: line.comment || null,
          });
          calls.push(
            supabase.rpc("update_pick_product_details", toUpdatePickProductDetailsRpcArgs(input)).then((result) => {
              if (result.error) throw result.error;
            }),
          );
        }
      }

      await Promise.all(calls);
    },
    onSuccess: () => {
      showToast("השורות נשמרו.", "success");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["grower", "pick-lines", dailyPickId] });
    },
    onError: (error: { message?: string }) => {
      showToast(`השמירה נכשלה: ${error.message ?? "שגיאה לא ידועה"}`, "error");
    },
  });

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setDraft((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function handleDiscard() {
    if (linesQuery.data) {
      setDraft(toDraftLines(linesQuery.data));
    }
    setEditing(false);
  }

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  const locked = pickStatus === "closed";

  if (linesQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!linesQuery.data || linesQuery.data.length === 0) {
    return <p className="text-sm text-ink-muted">אין מוצרים בעונה עבור מגדל זה.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <TableContainer>
        <TableHeader>
          <TableRow>
            <TableHead>מוצר</TableHead>
            <TableHead>פלטות שנקטפו</TableHead>
            <TableHead>שעת איסוף</TableHead>
            <TableHead>הערה</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {draft.map((line) => (
            <TableRow key={line.id}>
              <TableCell>{line.productLabel}</TableCell>
              <TableCell>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={!editing || locked}
                  className={inputClassName}
                  value={line.pallets}
                  onChange={(event) => updateLine(line.id, { pallets: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <input
                  type="time"
                  disabled={!editing || locked}
                  className={inputClassName}
                  value={line.pickupTime}
                  onChange={(event) => updateLine(line.id, { pickupTime: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <input
                  type="text"
                  disabled={!editing || locked}
                  className={inputClassName}
                  value={line.comment}
                  onChange={(event) => updateLine(line.id, { comment: event.target.value })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableContainer>

      {!locked && (
        <ActionBar
          editing={editing}
          saving={saving}
          canDelete={false}
          onEdit={() => setEditing(true)}
          onDiscard={handleDiscard}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
