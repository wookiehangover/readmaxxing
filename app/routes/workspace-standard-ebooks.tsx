import { useCallback } from "react";
import { StandardEbooksBrowser } from "~/components/standard-ebooks-browser";
import { useWorkspace } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

export default function WorkspaceStandardEbooksRoute() {
  const ws = useWorkspace();
  const handleBookAdded = useCallback(
    (book: BookMeta) => {
      ws.onBookAddedRef.current?.(book);
    },
    [ws],
  );

  return <StandardEbooksBrowser onBookAdded={handleBookAdded} />;
}
