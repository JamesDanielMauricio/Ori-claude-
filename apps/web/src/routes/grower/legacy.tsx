import { Link } from "react-router-dom";

import { EmptyState } from "@/components/ui/empty-state";
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
      {/* A signpost screen deserves a real destination card rather than a
          bare text link floating under the header — otherwise the page reads
          as unfinished rather than as deliberately retired. */}
      <div className="rounded-xl bg-surface shadow-raised ring-1 ring-inset ring-border/70">
        <EmptyState
          icon="clipboard"
          title="המסך הזה הוחלף"
          hint="כל עדכוני הקטיף של היום מתבצעים כעת במסך אחד — העדכון היומי."
          action={
            <Link
              to="/grower/picks"
              className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-ink shadow-accent transition-colors duration-200 hover:bg-accent-hover"
            >
              לעדכון היומי
            </Link>
          }
        />
      </div>
    </div>
  );
}
