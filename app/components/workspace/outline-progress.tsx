import { Skeleton } from "~/components/ui/skeleton";
import type { ReadingOutlinePendingPage } from "~/lib/reading-agent/artifacts-client";
import { cn } from "~/lib/utils";

export function OutlineProgress({
  pages,
  compact,
}: {
  pages: readonly ReadingOutlinePendingPage[];
  compact: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-5 py-3", { "px-4": !compact })}>
      {pages.map(({ unitId, page }) => (
        <div
          key={unitId}
          role="status"
          aria-label={page == null ? "Preparing outline" : `Preparing outline for page ${page}`}
          className="flex gap-3"
        >
          {page != null && <span className="pt-0.5 text-xs text-muted-foreground">{page}</span>}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div aria-hidden="true" className="flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
