import { useCallback } from "react";
import type { IDockviewPanelProps } from "dockview";
import type { BookMeta } from "~/lib/stores/book-store";
import { useWorkspace } from "~/lib/context/workspace-context";
import { StandardEbooksBrowser } from "~/components/standard-ebooks-browser";

export function StandardEbooksPanel(_props: IDockviewPanelProps<Record<string, never>>) {
  const ws = useWorkspace();

  const handleBookAdded = useCallback(
    (book: BookMeta) => {
      ws.onBookAddedRef.current?.(book);
    },
    [ws],
  );

  return <StandardEbooksBrowser onBookAdded={handleBookAdded} />;
}
