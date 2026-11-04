import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { useToast } from "@/components/ui/toast";

import { PHOTO_MAX_BYTES, PHOTO_MIME_EXTENSIONS, type FamilyFormState } from "./catalog-form";

// The family photo a distributor has picked but not saved yet: the file, a
// local preview of it, the hidden file input, and the two handlers that
// change it. Nothing here touches Storage — the upload happens on save
// (useFamilyMutations).
export function useFamilyPhoto({
  showToast,
  setFamilyForm,
}: {
  showToast: ReturnType<typeof useToast>["showToast"];
  setFamilyForm: Dispatch<SetStateAction<FamilyFormState>>;
}) {
  // A picked-but-not-yet-saved photo. Nothing is uploaded to Storage until
  // the family is actually saved (handleSaveFamily) — the same "nothing
  // touches the server until שמור" rule every other field on this form
  // already follows — so cancelling an edit after picking a file uploads
  // nothing and leaves no orphaned object behind.
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Local preview only, via a blob: URL. Revoked on every change and on
  // unmount so switching photos (or switching away without saving) never
  // leaks memory.
  useEffect(() => {
    if (!pendingPhotoFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingPhotoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingPhotoFile]);

  // Validated against the same limits Storage itself enforces
  // (0058_product-photo-storage-bucket.sql) so a rejected file gets a Hebrew
  // toast here rather than a raw API error after an upload attempt.
  function handlePhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // Clears the input's own value so picking the exact same file again
    // still fires this handler (a file input otherwise treats an unchanged
    // selection as a no-op change).
    event.target.value = "";
    if (!file) return;
    if (!(file.type in PHOTO_MIME_EXTENSIONS)) {
      showToast("ניתן להעלות תמונות מסוג JPEG, PNG או WebP בלבד.", "error");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      showToast("התמונה גדולה מדי (עד 5MB).", "error");
      return;
    }
    setPendingPhotoFile(file);
  }

  function handleRemovePhoto() {
    setPendingPhotoFile(null);
    setFamilyForm((current) => ({ ...current, imageUrl: "" }));
  }

  return {
    pendingPhotoFile,
    setPendingPhotoFile,
    photoPreviewUrl,
    photoInputRef,
    handlePhotoFileChange,
    handleRemovePhoto,
  };
}
