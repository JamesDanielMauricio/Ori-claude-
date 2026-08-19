import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";

// The PRD's "Legacy Product mode" (grower-home.md): an older
// product-by-product entry interface, "retained but not the primary
// path." Deliberately not rebuilt — the Daily List screen covers the
// whole picking flow — so this route is an honest signpost rather than a
// bare placeholder or a broken link.
export default function GrowerLegacyProductPage() {
  return (
    <div className="max-w-xl">
      <PageHeader
        title="מצב מוצרים (ישן)"
        subtitle="הממשק הישן לעדכון מוצר-מוצר הוחלף ברשימת העדכון היומית, שמרכזת את כל הקטיף של היום במסך אחד."
      />
      <Link href="/grower/picks" className="text-sm text-accent hover:underline">
        לעדכון היומי ‹
      </Link>
    </div>
  );
}
