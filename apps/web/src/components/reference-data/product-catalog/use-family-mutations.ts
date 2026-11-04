import { useMutation, type QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import type { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/error-message";
import { mergeOnError, optimisticUpdate } from "@/lib/optimistic-mutation";
import { referenceDataQueries, type ProductFamily } from "@/lib/queries/reference-data";
import { createClient } from "@/lib/supabase/client";

import {
  NEW_FAMILY_ID,
  PHOTO_MIME_EXTENSIONS,
  PRODUCT_PHOTOS_BUCKET,
  productPhotoPathFromUrl,
  type FamilyFormState,
} from "./catalog-form";

// Saving (including uploading a newly picked photo) and deleting a family,
// each patching the table at once and rolling back if the server refuses.
export function useFamilyMutations({
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
}: {
  queryClient: QueryClient;
  showToast: ReturnType<typeof useToast>["showToast"];
  editingFamilyId: string | null;
  setEditingFamilyId: Dispatch<SetStateAction<string | null>>;
  familyForm: FamilyFormState;
  editingFamily: ProductFamily | null;
  pendingPhotoFile: File | null;
  setPendingPhotoFile: Dispatch<SetStateAction<File | null>>;
  deleteFamilyTargetId: string | null;
  setDeleteFamilyTargetId: Dispatch<SetStateAction<string | null>>;
  familyById: ReadonlyMap<string, ProductFamily>;
}) {
  const supabase = createClient();
  const familiesQueryKey = referenceDataQueries.productFamilies().queryKey;

  const saveFamilyOptimistic = optimisticUpdate<ProductFamily[], void>(
    queryClient,
    familiesQueryKey,
    (families) =>
      families?.map((family) =>
        family.id === editingFamilyId
          ? {
              ...family,
              name: familyForm.name.trim(),
              category: familyForm.category.trim() || null,
              image_url: familyForm.imageUrl.trim() || null,
            }
          : family,
      ),
  );

  // A plain table write, not an RPC like `save_product` — a family is three
  // independent text columns with no child rows to keep in step and no
  // `version` column, so there is nothing here for a transaction-scoped
  // function to make atomic. The write is allowed by the
  // `product_families_write_backoffice` policy
  // (0006_reference-data-rls.sql): only a signed-in user whose
  // `current_role()` is 'backoffice' may insert/update/delete a family,
  // while every authenticated role may read them — which is what stops a
  // grower or a customer renaming the catalog everyone else orders from,
  // and it is enforced in the database, not by this screen being
  // backoffice-only.
  //
  // Editing a family carries no optimistic-concurrency check by design:
  // unlike a variety (R7, where two distributors pricing the same product
  // in the same minute is a real and costly collision), a family's name,
  // category and photo are near-static and a last-write-wins overwrite of
  // one of three text fields is recoverable by retyping it.
  const saveFamilyMutation = useMutation({
    mutationFn: async () => {
      if (!editingFamilyId) return;
      const previousImageUrl =
        editingFamilyId === NEW_FAMILY_ID ? null : (editingFamily?.image_url ?? null);

      let imageUrl = familyForm.imageUrl.trim() || null;
      if (pendingPhotoFile) {
        const extension = PHOTO_MIME_EXTENSIONS[pendingPhotoFile.type];
        // A fresh random filename every time, never the family's own id:
        // reusing one path across re-uploads would risk a CDN still serving
        // the OLD photo's cached bytes from that same URL after a
        // replacement is saved.
        const path = `${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(PRODUCT_PHOTOS_BUCKET)
          .upload(path, pendingPhotoFile, { contentType: pendingPhotoFile.type });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from(PRODUCT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
      }

      const values = {
        name: familyForm.name.trim(),
        category: familyForm.category.trim() || null,
        image_url: imageUrl,
      };
      // Create and update are the same three columns, so they're the same
      // form and the same button — only the verb differs, exactly as the
      // variety half of this screen treats its own draft row.
      const { error } =
        editingFamilyId === NEW_FAMILY_ID
          ? await supabase.from("product_families").insert(values)
          : await supabase.from("product_families").update(values).eq("id", editingFamilyId);
      if (error) throw error;

      // Best-effort cleanup of whatever photo this one just replaced. The row
      // is already saved with the new photo at this point, so a failed
      // removal here only leaves one unreferenced file in Storage rather than
      // losing or blocking anything the user asked for — same reasoning as
      // nudgeWhatsAppDispatch's fire-and-forget calls. productPhotoPathFromUrl
      // guards against ever touching a URL this app didn't itself upload.
      if (previousImageUrl && previousImageUrl !== imageUrl) {
        const oldPath = productPhotoPathFromUrl(previousImageUrl);
        if (oldPath) {
          void supabase.storage
            .from(PRODUCT_PHOTOS_BUCKET)
            .remove([oldPath])
            .then(({ error: removeError }) => {
              if (removeError) {
                console.warn("[product-photos] failed to remove replaced photo", removeError);
              }
            });
        }
      }
    },
    onMutate: saveFamilyOptimistic.onMutate,
    onSuccess: () => {
      showToast(editingFamilyId === NEW_FAMILY_ID ? "המשפחה נוצרה." : "המשפחה נשמרה.", "success");
      setEditingFamilyId(null);
      setPendingPhotoFile(null);
      void queryClient.invalidateQueries({ queryKey: familiesQueryKey });
    },
    onError: mergeOnError(saveFamilyOptimistic.onError, (error: { message?: string }) => {
      showToast(`שמירת המשפחה נכשלה: ${errorMessage(error)}`, "error");
    }),
  });

  const deleteFamilyOptimistic = optimisticUpdate<ProductFamily[], void>(
    queryClient,
    familiesQueryKey,
    (families) => families?.filter((family) => family.id !== deleteFamilyTargetId),
  );

  const deleteFamilyMutation = useMutation({
    mutationFn: async () => {
      if (!deleteFamilyTargetId) return;
      const photoUrl = familyById.get(deleteFamilyTargetId)?.image_url ?? null;
      const { error } = await supabase
        .from("product_families")
        .delete()
        .eq("id", deleteFamilyTargetId);
      if (error) throw error;

      // Best-effort, same reasoning as the replace-on-save cleanup above: the
      // family is already gone, so nothing but one unreferenced Storage file
      // is at stake if this fails.
      const photoPath = photoUrl ? productPhotoPathFromUrl(photoUrl) : null;
      if (photoPath) {
        void supabase.storage
          .from(PRODUCT_PHOTOS_BUCKET)
          .remove([photoPath])
          .then(({ error: removeError }) => {
            if (removeError) {
              console.warn("[product-photos] failed to remove deleted family's photo", removeError);
            }
          });
      }
    },
    onMutate: deleteFamilyOptimistic.onMutate,
    onSuccess: () => {
      showToast("המשפחה נמחקה.", "success");
      setDeleteFamilyTargetId(null);
      void queryClient.invalidateQueries({ queryKey: familiesQueryKey });
    },
    onError: mergeOnError(deleteFamilyOptimistic.onError, (error: { message?: string }) => {
      showToast(`מחיקת המשפחה נכשלה: ${errorMessage(error)}`, "error");
      setDeleteFamilyTargetId(null);
    }),
  });

  return { saveFamilyMutation, deleteFamilyMutation };
}
