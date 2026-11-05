import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import {
  RecordTable,
  type RecordTableGroup,
  type RecordTableGroupContent,
} from "@/components/reference-data/record-table";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { hasChanges } from "@/lib/has-changes";
import type { ProductFamily, ProductVariety } from "@/lib/queries/reference-data";

import { DeleteFamilyDialog, DeleteVarietyDialog } from "./product-catalog/catalog-dialogs";
import {
  NEW_FAMILY_ID,
  NEW_ROW_ID,
  blankFamily,
  blankFamilyForm,
  blankForm,
  blankRow,
  toFamilyForm,
  toFormState,
  type FamilyFormState,
  type FormState,
} from "./product-catalog/catalog-form";
import {
  buildAddRow,
  buildFamilyHeader,
  type FamilyHeaderContext,
} from "./product-catalog/family-header";
import { useCatalogData } from "./product-catalog/use-catalog-data";
import { useFamilyMutations } from "./product-catalog/use-family-mutations";
import { useFamilyPhoto } from "./product-catalog/use-family-photo";
import { useVarietyMutations } from "./product-catalog/use-variety-mutations";
import { buildVarietyColumns } from "./product-catalog/variety-columns";

// The Products management screen — catalog (family + variety), pricing,
// overbooking, and the per-customer pallet cap control. `save_product` is
// where the conflict-prevention rule actually lives (R7): every save
// carries the version this form last loaded, and a rejection means someone
// else saved first — surfaced here as a clear message and a forced reload,
// never a silent overwrite and never a UI "someone's editing this" lock.
//
// Mounted by two routes, because they are one screen over two row sets:
// /backoffice/products is the whole catalog, and /backoffice/picked-products
// is the same table narrowed to the varieties growers actually picked on the
// trading day the sidebar has selected. Narrowing it here — rather than
// copying the screen — is what keeps ONE write surface per product: the price
// a distributor changes while looking at today's picks goes through the same
// `save_product` call, with the same version check (R7), as one changed from
// the catalog.
//
// This file is the composition; its parts live in ./product-catalog/ — the
// reads (use-catalog-data), the writes (use-variety-mutations,
// use-family-mutations, use-family-photo), the table's columns
// (variety-columns), a family's header row (family-header), the delete
// dialogs, and the form helpers they share (catalog-form).
export function ProductCatalogScreen({
  title,
  subtitle,
  headerActions,
  varietyIds = null,
  extraLoading = false,
  emptyLabel = "אין מוצרים עדיין.",
}: {
  title: string;
  subtitle: string;
  // The page header's action slot — the day-scoped tab's "which day am I
  // looking at" pill, and nothing at all on the full catalog.
  headerActions?: ReactNode;
  // null = every variety, which is what the catalog tab wants. A set narrows
  // the table to those ids and to the families that still hold one of them.
  // Creating records is switched off while it is set — see `allowCreate`.
  varietyIds?: ReadonlySet<string> | null;
  // A query the CALLER is still waiting on, folded into this table's own
  // loading state. The filtered tab can't draw a correct list until it knows
  // which varieties were picked, and flashing the whole catalog in the
  // meantime would be wrong rather than merely early.
  extraLoading?: boolean;
  emptyLabel?: string;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Which row (by id) is being edited inline right now — NEW_ROW_ID for a
  // draft that hasn't been saved yet, an existing row's own id, or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm(""));
  const [saving, setSaving] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // The catalog's second editable level. Families are their own record with
  // their own form and their own save, deliberately kept apart from the
  // variety form above: the two never open at once (each locks the other —
  // see `tableEditingId` below), so one screen still only ever has one form
  // and one save button live at a time.
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [familyForm, setFamilyForm] = useState<FamilyFormState>(blankFamilyForm);
  const [savingFamily, setSavingFamily] = useState(false);
  const [deleteFamilyTargetId, setDeleteFamilyTargetId] = useState<string | null>(null);

  // A picked-but-not-yet-saved photo for the family form — see
  // useFamilyPhoto. Nothing is uploaded until the family is saved.
  const {
    pendingPhotoFile,
    setPendingPhotoFile,
    photoPreviewUrl,
    photoInputRef,
    handlePhotoFileChange,
    handleRemovePhoto,
  } = useFamilyPhoto({ showToast, setFamilyForm });

  // Which families are open. Everything starts collapsed: the catalog runs
  // to ~78 families and ~600 varieties, and a screen that opens every one of
  // them is the flat table this grouping replaced.
  const [expandedFamilyIds, setExpandedFamilyIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const { familiesQuery, familyById, productsQuery, capsQuery } = useCatalogData();

  const editingRowId = editingId !== null && editingId !== NEW_ROW_ID ? editingId : null;
  const selected = productsQuery.data?.find((row) => row.id === editingRowId) ?? null;
  const deleteTarget = productsQuery.data?.find((row) => row.id === deleteTargetId) ?? null;

  const { saveMutation, deleteMutation } = useVarietyMutations({
    queryClient,
    showToast,
    form,
    setForm,
    editingRowId,
    setEditingId,
    deleteTargetId,
    setDeleteTargetId,
  });

  const editingFamily = familyById.get(editingFamilyId ?? "") ?? null;

  const { saveFamilyMutation, deleteFamilyMutation } = useFamilyMutations({
    queryClient,
    showToast,
    editingFamilyId,
    setEditingFamilyId,
    familyForm,
    editingFamily,
    pendingPhotoFile,
    setPendingPhotoFile,
    deleteFamilyTargetId,
    setDeleteFamilyTargetId,
    familyById,
  });

  // A draft family's baseline is the blank form, so "שמור" lights up the
  // moment a name is typed; an existing one's is what the server holds.
  const familyBaseline =
    editingFamilyId === NEW_FAMILY_ID
      ? blankFamilyForm()
      : editingFamily
        ? toFamilyForm(editingFamily)
        : null;
  // A picked-but-unsaved photo doesn't touch familyForm.imageUrl until the
  // upload actually completes inside saveFamilyMutation (see its comment),
  // so hasChanges alone can't see it — checked separately here or picking a
  // new photo and nothing else would leave "שמור" disabled.
  const familyDirty =
    (familyBaseline ? hasChanges(familyForm, familyBaseline) : false) || pendingPhotoFile !== null;

  function openFamily(familyId: string) {
    setExpandedFamilyIds((current) => {
      if (current.has(familyId)) return current;
      const next = new Set(current);
      next.add(familyId);
      return next;
    });
  }

  function toggleFamily(familyId: string) {
    setExpandedFamilyIds((current) => {
      const next = new Set(current);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  }

  function handleEditFamily(family: ProductFamily) {
    setEditingFamilyId(family.id);
    setFamilyForm(toFamilyForm(family));
    setPendingPhotoFile(null);
  }

  function handleNewFamily() {
    setEditingId(null);
    setEditingFamilyId(NEW_FAMILY_ID);
    setFamilyForm(blankFamilyForm());
    setPendingPhotoFile(null);
  }

  function handleCancelFamily() {
    setEditingFamilyId(null);
    setPendingPhotoFile(null);
  }

  function handleSaveFamily() {
    setSavingFamily(true);
    saveFamilyMutation.mutate(undefined, { onSettled: () => setSavingFamily(false) });
  }

  // Seeded synchronously from data the table already has — the caps are
  // loaded up front for their column, not lazily on click.
  //
  // The row's family is opened here rather than left to RecordTable's own
  // "keep the editing row visible" rule, because that rule lapses the
  // instant the edit ends: a variety saved inside a collapsed family would
  // disappear at the moment the user is looking for confirmation it landed.
  function handleEditRow(row: ProductVariety) {
    setEditingId(row.id);
    openFamily(row.family_id);
    setForm(toFormState(row, capsQuery.data?.get(row.id) ?? []));
  }

  // Starts a draft variety already assigned to one family. The family is
  // opened as well as selected, because the draft row is grouped by the
  // family the FORM names (see `getGroupId`) — into a collapsed group it
  // would be seeded correctly and then be invisible.
  function handleNewInFamily(familyId: string) {
    setEditingId(NEW_ROW_ID);
    openFamily(familyId);
    setForm(blankForm(familyId));
  }

  function handleCancel() {
    setEditingId(null);
  }

  // What the form would hold with no unsaved edits — decides whether the
  // save button has anything to do.
  //
  // `version` rides along inside FormState but can never differ between the
  // two sides: nothing in this form edits it, and a save that bumps it also
  // re-seeds the form from the returned row. It is the optimistic-locking
  // token (R7), not a field, so it neither can nor should make the form read
  // as changed.
  //
  // A draft's baseline is a blank form in the draft's OWN family. The family
  // comes from which "זן חדש" was clicked, not from anything the user typed,
  // so it must not light up the save button on an otherwise empty draft —
  // which it did when this compared against whichever family sorts first.
  const baselineForm = selected
    ? toFormState(selected, capsQuery.data?.get(selected.id) ?? [])
    : blankForm(form.familyId);
  const dirty = hasChanges(form, baselineForm);

  function handleSave() {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  }

  // The table's columns — the read and edit cell of every field (see
  // buildVarietyColumns).
  const columns = buildVarietyColumns({
    form,
    setForm,
    familyById,
    familiesQuery,
    openFamily,
  });

  // Creating a record is offered on the unfiltered catalog only. A brand-new
  // variety has no pick line and a brand-new family has no varieties, so
  // neither can satisfy `varietyIds` — on the filtered tab the "זן חדש" row
  // and the "משפחה חדשה" button would save a record and then drop it straight
  // out of the list, which reads as the save having failed. Editing and
  // deleting stay on both tabs: those act on a record already in front of you.
  const allowCreate = varietyIds === null;

  // What this tab lists, before the search box gets its turn.
  const listedRows = useMemo(() => {
    const catalog = productsQuery.data ?? [];
    return varietyIds ? catalog.filter((row) => varietyIds.has(row.id)) : catalog;
  }, [productsQuery.data, varietyIds]);

  const rows = editingId === NEW_ROW_ID ? [blankRow(form.familyId), ...listedRows] : listedRows;

  // How many varieties each family holds IN THIS TAB'S LIST — counted off
  // `listedRows` rather than off what the search left standing: the number on
  // a header row answers "how big is this family here", which doesn't change
  // because someone typed in the search box. On the filtered tab that is the
  // picked count, not the catalog count, so the chip agrees with the rows
  // listed underneath it.
  const varietyCountByFamily = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of listedRows) {
      counts.set(row.family_id, (counts.get(row.family_id) ?? 0) + 1);
    }
    return counts;
  }, [listedRows]);

  // The same count over the WHOLE catalog, and the only one the delete-family
  // guard may use: product_varieties.family_id is a NOT NULL foreign key with
  // no cascade, so whether Postgres will accept the delete depends on every
  // variety pointing at the family — including the ones this tab filtered out.
  // That is why the dialog below can say "יש בה 40 זנים" over a header chip
  // reading "2 זנים": the chip counts today's picks, the FK counts all of them.
  const catalogCountByFamily = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of productsQuery.data ?? []) {
      counts.set(row.family_id, (counts.get(row.family_id) ?? 0) + 1);
    }
    return counts;
  }, [productsQuery.data]);

  const deleteFamilyTarget = familyById.get(deleteFamilyTargetId ?? "") ?? null;
  const deleteFamilyVarietyCount = deleteFamilyTargetId
    ? (catalogCountByFamily.get(deleteFamilyTargetId) ?? 0)
    : 0;

  // Only one form is live on this screen at a time. Handing RecordTable the
  // family's id while a family is being edited locks every variety row's
  // edit/delete and the add button exactly as a row edit does, and routes
  // Escape to the family form's own cancel.
  const tableEditingId = editingFamilyId ?? editingId;

  const toGroup = (family: ProductFamily): RecordTableGroup => ({
    id: family.id,
    // The family's own name and category, so searching "פירות" finds a
    // family whose varieties never mention the word.
    searchText: `${family.name} ${family.category ?? ""}`,
    header: (expanded) =>
      renderFamilyHeader(family, varietyCountByFamily.get(family.id) ?? 0, expanded),
    // Pressing anywhere on the family's row opens or closes it, not only the
    // chevron. A draft family has nothing to open onto, so it gets none.
    onToggle: family.id === NEW_FAMILY_ID ? undefined : () => toggleFamily(family.id),
  });

  // An empty family still earns a header on the catalog tab — it is a real
  // record, and the "זן חדש" row inside it is the only way to fill it. On the
  // filtered tab it earns nothing: 78 headers over a handful of picked rows is
  // the list the filter exists to remove. The family being edited is kept
  // either way, so renaming one can't make it — and the row under it — vanish
  // mid-edit.
  const listedFamilies = (familiesQuery.data ?? []).filter(
    (family) =>
      varietyIds === null ||
      (varietyCountByFamily.get(family.id) ?? 0) > 0 ||
      family.id === editingFamilyId,
  );

  // A new family's draft header sits at the top of the table, the same
  // place — and for the same reason — the draft VARIETY row goes: the row
  // you just asked for is where you are already looking, not somewhere
  // alphabetical you have to hunt for.
  const groups: RecordTableGroup[] = [
    ...(editingFamilyId === NEW_FAMILY_ID ? [toGroup(blankFamily())] : []),
    ...listedFamilies.map(toGroup),
  ];

  // A family's header row — its toggle, photo, name, category, variety
  // count and buttons, or its edit band while it is being edited (see
  // buildFamilyHeader). Both helpers are called by RecordTable as it draws.
  const familyHeader: FamilyHeaderContext = {
    editingFamilyId,
    tableEditingId,
    savingFamily,
    familyDirty,
    familyForm,
    setFamilyForm,
    pendingPhotoFile,
    photoPreviewUrl,
    photoInputRef,
    handlePhotoFileChange,
    handleRemovePhoto,
    toggleFamily,
    handleSaveFamily,
    handleCancelFamily,
    handleEditFamily,
    setDeleteFamilyTargetId,
  };

  function renderFamilyHeader(
    family: ProductFamily,
    varietyCount: number,
    expanded: boolean,
  ): RecordTableGroupContent {
    return buildFamilyHeader(familyHeader, family, varietyCount, expanded);
  }

  function renderAddRow(group: RecordTableGroup): RecordTableGroupContent {
    return buildAddRow(group, familyById, handleNewInFamily);
  }

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={headerActions} />
      <RecordTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        searchText={(row) => `${row.name} ${familyById.get(row.family_id)?.name ?? ""}`}
        editingId={tableEditingId}
        savingEdit={saving}
        dirtyEdit={dirty}
        onEdit={handleEditRow}
        onSaveEdit={handleSave}
        onCancelEdit={editingFamilyId ? handleCancelFamily : handleCancel}
        onDelete={(row) => setDeleteTargetId(row.id)}
        // No `onAdd`: a variety is created from the "זן חדש" row inside an
        // open family, never from the toolbar. A variety cannot exist without
        // a family — product_varieties.family_id is a NOT NULL foreign key,
        // and saveProductInputSchema requires a uuid — so a toolbar "new
        // product" had no family to name and papered over it by silently
        // picking whichever family happened to sort first, leaving the user
        // to correct it in a dropdown. With no families at all it produced a
        // draft that could never be saved and rendered outside every group.
        // Adding from inside a family states the family by construction.
        //
        // The cost, accepted: with every family collapsed (the state the
        // screen opens in) there is no add control on screen until a family
        // is opened. That matches the screen's own premise — the subtitle
        // already says a family opens onto its varieties — and creating a
        // FAMILY, which genuinely has no parent to sit inside, keeps its
        // toolbar button below.
        toolbarExtra={
          allowCreate ? (
            <Button
              type="button"
              variant="secondary"
              onClick={handleNewFamily}
              disabled={tableEditingId !== null}
            >
              <Icon name="plusCircle" className="h-4 w-4" />
              משפחה חדשה
            </Button>
          ) : undefined
        }
        grouping={{
          groups,
          // The first row inside an opened family: adding a variety here
          // carries the family with it, so the משפחה dropdown on the draft
          // comes up already answered instead of asking the user to name a
          // family they just pointed at. Omitted entirely on the filtered
          // tab — see `allowCreate`.
          renderAddRow: allowCreate ? renderAddRow : undefined,
          // The row being edited is grouped by the family it will be SAVED
          // to, not the one it currently belongs to — so both a draft row
          // and a variety being moved between families appear under the
          // family their dropdown names, the moment it is chosen.
          getGroupId: (row) => (row.id === editingId ? form.familyId : row.family_id),
          expandedIds: expandedFamilyIds,
        }}
        loading={
          extraLoading || productsQuery.isLoading || capsQuery.isLoading || familiesQuery.isLoading
        }
        // Families are the table's groups and caps are a column, so any of
        // the three missing leaves a table that misreports the catalog.
        loadError={
          (productsQuery.isError && !productsQuery.data) ||
          (capsQuery.isError && !capsQuery.data) ||
          (familiesQuery.isError && !familiesQuery.data)
            ? {
                what: "קטלוג המוצרים",
                onRetry: () => {
                  void productsQuery.refetch();
                  void capsQuery.refetch();
                  void familiesQuery.refetch();
                },
                retrying: productsQuery.isFetching || capsQuery.isFetching || familiesQuery.isFetching,
              }
            : null
        }
        searchPlaceholder="חיפוש מוצר, זן או משפחה"
        emptyLabel={emptyLabel}
      />

      <DeleteVarietyDialog
        open={deleteTargetId !== null}
        target={deleteTarget}
        pending={deleteMutation.isPending}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => deleteMutation.mutate()}
      />

      <DeleteFamilyDialog
        open={deleteFamilyTargetId !== null}
        familyName={deleteFamilyTarget?.name}
        varietyCount={deleteFamilyVarietyCount}
        pending={deleteFamilyMutation.isPending}
        onClose={() => setDeleteFamilyTargetId(null)}
        onConfirm={() => deleteFamilyMutation.mutate()}
      />
    </>
  );
}
