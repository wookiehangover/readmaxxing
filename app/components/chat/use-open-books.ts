import { useEffect, useMemo, useState } from "react";
import type { BookMeta } from "~/lib/stores/book-store";
import { useOptionalWorkspace } from "~/lib/context/workspace-context";
import { useAppStore } from "~/lib/themis/provider";

/** Derives currently-open books from the workspace's authoritative open-book set. */
export function useOpenBooks(workspace: ReturnType<typeof useOptionalWorkspace>): BookMeta[] {
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks.useValue();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!workspace) return;
    return workspace.subscribeClusterChanges(() => setVersion((value) => value + 1));
  }, [workspace]);

  return useMemo(() => {
    if (!workspace) return [];
    void version;
    const openIds = workspace.openBookIdsRef.current;
    return books.filter((book) => openIds.has(book.id));
  }, [books, workspace, version]);
}
