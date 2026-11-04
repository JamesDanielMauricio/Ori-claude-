import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from "react";

import { inputClassName } from "@/components/reference-data/form-field";
import {
  RowIconButton,
  type RecordTableGroup,
  type RecordTableGroupContent,
} from "@/components/reference-data/record-table";
import { StatusPill } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { ProductThumbnail } from "@/components/ui/product-thumbnail";
import type { ProductFamily } from "@/lib/queries/reference-data";

import {
  NAME_GUTTER,
  NEW_FAMILY_ID,
  varietyCountLabel,
  type FamilyFormState,
} from "./catalog-form";

// What a family's header row needs from the screen: which edit (if any) is
// open, the family form, the picked photo, and the handlers its buttons call.
export interface FamilyHeaderContext {
  editingFamilyId: string | null;
  tableEditingId: string | null;
  savingFamily: boolean;
  familyDirty: boolean;
  familyForm: FamilyFormState;
  setFamilyForm: Dispatch<SetStateAction<FamilyFormState>>;
  pendingPhotoFile: File | null;
  photoPreviewUrl: string | null;
  photoInputRef: RefObject<HTMLInputElement | null>;
  handlePhotoFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleRemovePhoto: () => void;
  toggleFamily: (familyId: string) => void;
  handleSaveFamily: () => void;
  handleCancelFamily: () => void;
  handleEditFamily: (family: ProductFamily) => void;
  setDeleteFamilyTargetId: Dispatch<SetStateAction<string | null>>;
}

export function buildAddRow(
  group: RecordTableGroup,
  familyById: ReadonlyMap<string, ProductFamily>,
  handleNewInFamily: (familyId: string) => void,
): RecordTableGroupContent {
  return {
    kind: "cells",
    actions: null,
    cells: {
      name: (
        <button
          type="button"
          onClick={() => handleNewInFamily(group.id)}
          // One of these exists per open family, so the visible "זן חדש"
          // alone would name several buttons identically. The family name is
          // appended rather than substituted, so the accessible name still
          // starts with the text on screen.
          aria-label={`זן חדש ${familyById.get(group.id)?.name ?? ""}`.trim()}
          className="group/add flex items-center text-start"
        >
          {/* The plus rides in the same gutter the family's chevron and
              photo use, so the label beside it lines up with every variety
              name in the column and the row reads as the first entry in the
              list rather than a banner over it. */}
          <span className={`flex ${NAME_GUTTER} shrink-0 items-center`}>
            <Icon
              name="plusCircle"
              className="h-4 w-4 text-ink-subtle transition-colors duration-150 group-hover/add:text-accent"
            />
          </span>
          <span className="text-sm font-medium text-ink-muted transition-colors duration-150 group-hover/add:text-accent">
            זן חדש
          </span>
        </button>
      ),
    },
  };
}

// The family's photo control, live only while its own edit form is open.
// Clicking the picture itself opens the file picker (handlePhotoFileChange)
// — one control on the thing it acts on, rather than a separate "add
// photo" / "remove photo" pair of icon buttons sitting elsewhere in the
// row. The × badge only appears once a photo actually exists, so an empty
// slot shows nothing to remove.

// The family's photo control, live only while its own edit form is open.
// Clicking the picture itself opens the file picker (handlePhotoFileChange)
// — one control on the thing it acts on, rather than a separate "add
// photo" / "remove photo" pair of icon buttons sitting elsewhere in the
// row. The × badge only appears once a photo actually exists, so an empty
// slot shows nothing to remove.
function FamilyPhotoButton({
  pendingPhotoFile,
  imageUrl,
  previewUrl,
  inputRef,
  disabled,
  onRemove,
}: {
  pendingPhotoFile: File | null;
  imageUrl: string;
  previewUrl: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onRemove: () => void;
}) {
  const hasPhoto = Boolean(pendingPhotoFile || imageUrl.trim());
  return (
    <span className="group/photo relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label={hasPhoto ? "החלפת תמונת המשפחה" : "העלאת תמונת המשפחה"}
        className="block rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
      >
        <ProductThumbnail imageUrl={previewUrl ?? imageUrl} size="sm" />
      </button>
      {hasPhoto && (
        <button
          type="button"
          onClick={(event) => {
            // Otherwise this click bubbles up through the photo button
            // above and reopens the file picker the same instant the
            // photo clears.
            event.stopPropagation();
            onRemove();
          }}
          disabled={disabled}
          aria-label="הסרת תמונה"
          className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-danger-ink opacity-0 shadow-sm ring-1 ring-inset ring-border transition-opacity duration-150 group-hover/photo:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none"
        >
          <Icon name="close" className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

export function buildFamilyHeader(
  ctx: FamilyHeaderContext,
  family: ProductFamily,
  varietyCount: number,
  expanded: boolean,
): RecordTableGroupContent {
  const {
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
  } = ctx;
  const isEditing = editingFamilyId === family.id;
  const isDraft = family.id === NEW_FAMILY_ID;
  // Locked while any OTHER edit is open — a row's, or another family's.
  const locked = tableEditingId !== null && !isEditing;

  // The family's expand toggle, drawn wherever the caller of this helper
  // puts it. It stays available while the family is being edited —
  // renaming a family and checking what's inside it are independent, and
  // taking the chevron away mid-edit would be a dead end. A draft family
  // has nothing to expand onto, so it gets a plain photo control instead.
  //
  // While the family is only being read, the rest of its row toggles too
  // (the group's `onToggle`, in `toGroup`), so the chevron lights up when
  // the pointer is anywhere on the row (`group-hover/section:`), not just
  // over this button.
  //
  // Mid-edit, the chevron and the photo split into two independent
  // controls (renderPhotoButton) instead of sharing one button: the
  // chevron still toggles expand/collapse, but the photo itself now needs
  // its own click target to open the file picker, and one <button> can't
  // do both jobs at once.
  const toggle = isDraft ? (
    <FamilyPhotoButton
      pendingPhotoFile={pendingPhotoFile}
      imageUrl={familyForm.imageUrl}
      previewUrl={photoPreviewUrl}
      inputRef={photoInputRef}
      disabled={savingFamily}
      onRemove={handleRemovePhoto}
    />
  ) : isEditing ? (
    <span className={`flex ${NAME_GUTTER} shrink-0 items-center gap-2`}>
      <button
        type="button"
        onClick={() => toggleFamily(family.id)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "כווץ" : "הרחב"} ${family.name}`}
        className="group flex shrink-0 items-center rounded-md p-1"
      >
        <Icon
          name="chevronDown"
          className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
            expanded ? "rotate-180 text-accent" : "text-ink-muted group-hover:text-accent"
          }`}
        />
      </button>
      <FamilyPhotoButton
        pendingPhotoFile={pendingPhotoFile}
        imageUrl={familyForm.imageUrl}
        previewUrl={photoPreviewUrl}
        inputRef={photoInputRef}
        disabled={savingFamily}
        onRemove={handleRemovePhoto}
      />
    </span>
  ) : (
    <button
      type="button"
      onClick={() => toggleFamily(family.id)}
      aria-expanded={expanded}
      aria-label={`${expanded ? "כווץ" : "הרחב"} ${family.name}`}
      className="group flex shrink-0 items-center rounded-md py-1 text-start"
    >
      {/* The gutter. Fixed at NAME_GUTTER so the name after it starts on the
          same edge as every variety name in this column; its contents come
          to 56px (chevron, gap, photo), which leaves the remaining 8px as
          the gap before the name. */}
      <span className={`flex ${NAME_GUTTER} shrink-0 items-center gap-2`}>
        <Icon
          name="chevronDown"
          className={`h-4 w-4 shrink-0 transition-[transform,color] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
            expanded
              ? "rotate-180 text-accent"
              : "text-ink-muted group-hover:text-accent group-hover/section:text-accent"
          }`}
        />
        <ProductThumbnail imageUrl={family.image_url} size="sm" />
      </span>
      {/* A shade larger than a row's own text: this is a section title, and
          the band it sits on reads as a section, so the name should lead it
          rather than match the varieties listed underneath. */}
      <span className="truncate text-[0.9375rem] font-semibold text-ink">{family.name}</span>
    </button>
  );

  // Editing falls back to one full-width band rather than the column grid
  // the read state uses. The category and photo fields are the reason: they
  // need more room than a `גודל` column that is barely 4rem, so sitting them
  // in a cell would re-measure every column in the table and shove the
  // variety rows sideways on each keystroke. `sticky start-0` keeps the form
  // parked at the frozen edge while the table scrolls under it; `px-4`
  // matches the padding a row's own cells carry (table.tsx), so the
  // controls stay in line with the varieties' edit/delete.
  if (isEditing) {
    return {
      kind: "band",
      content: (
        <div className="sticky start-0 flex w-fit max-w-full items-center gap-2.5 px-4 py-2.5">
          <RowIconButton
            icon="checkCircle"
            label="שמור משפחה"
            tone="accent"
            onClick={handleSaveFamily}
            disabled={savingFamily || !familyDirty || familyForm.name.trim() === ""}
          />
          <RowIconButton
            icon="close"
            label="ביטול עריכת משפחה"
            tone="neutral"
            onClick={handleCancelFamily}
            disabled={savingFamily}
          />
          {toggle}
          <input
            aria-label="שם המשפחה"
            autoFocus
            required
            placeholder={isDraft ? "שם המשפחה" : undefined}
            className={`${inputClassName} w-40`}
            value={familyForm.name}
            onChange={(event) =>
              setFamilyForm((current) => ({ ...current, name: event.target.value }))
            }
          />
          <input
            aria-label="קטגוריית המשפחה"
            placeholder="קטגוריה"
            className={`${inputClassName} w-32`}
            value={familyForm.category}
            onChange={(event) =>
              setFamilyForm((current) => ({ ...current, category: event.target.value }))
            }
          />
          {/* File picker for the family's photo, opened by clicking the
              thumbnail itself (renderPhotoButton, inside `toggle` above) —
              uploaded to Storage only on שמור (see saveFamilyMutation), not
              the moment it's picked, so cancelling this edit uploads
              nothing. Replaces what used to be a raw "paste a URL" box:
              nothing else in this app hosts an image anywhere else a URL
              could sensibly come from. */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handlePhotoFileChange}
          />
        </div>
      ),
    };
  }

  // Reading: the family's own fields go in the very columns its varieties
  // use, so the one header row stands for both levels — name under
  // "זן / משפחה", category under "משפחה / קטגוריה", the variety count under
  // "גודל / מספר זנים". The family name no longer stays frozen at the start
  // edge as it did when this was a band, and doesn't need to: every variety
  // row carries its family in its own column, which is the redundancy that
  // now earns its keep.
  return {
    kind: "cells",
    actions: (
      <div className="flex items-center gap-1.5">
        {/* Deliberately not disabled for a family that still holds
            varieties: the button opens a dialog that explains WHY it can't
            go (and offers no delete), which teaches the rule. A greyed-out
            trash teaches nothing, and its `title` tooltip never fires on a
            disabled control. */}
        <RowIconButton
          icon="trash"
          label="מחק משפחה"
          tone="danger"
          onClick={() => setDeleteFamilyTargetId(family.id)}
          disabled={locked}
        />
        <RowIconButton
          icon="pencil"
          label="ערוך משפחה"
          tone="neutral"
          onClick={() => handleEditFamily(family)}
          disabled={locked}
        />
      </div>
    ),
    cells: {
      name: toggle,
      family: family.category ? <StatusPill tone="neutral">{family.category}</StatusPill> : null,
      sizes: (
        // ink-muted, not ink-subtle: this sits on the family row's tinted
        // band, where ink-subtle measures under 4.5:1 (4.1:1 light, 4.0:1
        // dark) — see the band notes in globals.css.
        <span className="whitespace-nowrap text-xs font-semibold text-ink-muted">
          {varietyCountLabel(varietyCount)}
        </span>
      ),
    },
  };
}
