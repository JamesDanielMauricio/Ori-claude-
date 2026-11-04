import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ProductVariety } from "@/lib/queries/reference-data";
import { formatVarietyName } from "@/lib/variety-label";

import { varietyCountLabel } from "./catalog-form";

// Confirming that a variety is to be deleted.
export function DeleteVarietyDialog({
  open,
  target,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  target: ProductVariety | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="מחיקת מוצר">
      <p className="mb-4 text-sm">
        האם למחוק את המוצר &quot;
        {target ? formatVarietyName(target.name, target.sizes) : ""}&quot;? פעולה זו אינה הפיכה.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          ביטול
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending}>
          {pending ? "מוחק…" : "מחק"}
        </Button>
      </div>
    </Dialog>
  );
}

// Deleting a family is blocked while it still holds varieties —
// product_varieties.family_id is a NOT NULL foreign key with no
// cascade (product-variety.ts), so the database would refuse the
// delete anyway. Refusing it HERE, with the count and the reason,
// turns an opaque 23503 error toast into an instruction; and the
// alternative the FK rules out — deleting a family and silently
// taking its varieties with it — would erase catalog items that
// growers' picks and customers' orders still reference.
export function DeleteFamilyDialog({
  open,
  familyName,
  varietyCount,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  familyName: string | undefined;
  varietyCount: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="מחיקת משפחה">
      {varietyCount > 0 ? (
        <p className="mb-4 text-sm">
          לא ניתן למחוק את המשפחה &quot;{familyName}&quot; — יש בה {varietyCountLabel(varietyCount)}
          . יש למחוק אותם, או להעביר אותם למשפחה אחרת, ואז למחוק את המשפחה.
        </p>
      ) : (
        <p className="mb-4 text-sm">
          האם למחוק את המשפחה &quot;{familyName}&quot;? פעולה זו אינה הפיכה.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {varietyCount > 0 ? "סגור" : "ביטול"}
        </Button>
        {varietyCount === 0 && (
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {pending ? "מוחק…" : "מחק"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
