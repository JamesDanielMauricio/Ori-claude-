import { Skeleton } from "@/components/ui/skeleton";

// Suspense fallback for every /backoffice/* route transition — shown the
// instant a sidebar link is clicked, while the target route's lazily
// imported chunk is still downloading. Without it, React would have no
// fallback to render for the swap, so the previous screen would just sit
// there looking unresponsive until the new one is ready. One shared
// skeleton here, not one per screen — this is scaffolding, not content, so
// it doesn't need to match each page's actual layout.
export default function BackofficeLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
