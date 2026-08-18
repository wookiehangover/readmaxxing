import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { useWorkspace, type WorkspaceContextValue } from "~/lib/context/workspace-context";
import { ensureLocalThenOpen, refreshWorkspaceBooks } from "~/lib/library-book-open";
import { getBookReadingPath, getReadingBookId } from "~/lib/reading-route";
import type { BookMeta } from "~/lib/stores/book-store";

type WorkspaceBookRefs = Pick<WorkspaceContextValue, "openBookRef">;
type Navigate = (path: string) => void | Promise<void>;

export function openBookInWorkspace(
  book: BookMeta,
  workspace: WorkspaceBookRefs,
  navigate: Navigate,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return;
  workspace.openBookRef.current?.(book);
  void navigate(getBookReadingPath(book.id));
}

export default function WorkspaceLibraryRoute() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const pendingOpenControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      // Preserve the intended /library → /books/:id handoff; otherwise abort the pending open
      // when leaving the library route.
      if (getReadingBookId(window.location.pathname) === null) {
        pendingOpenControllerRef.current?.abort();
      }
    },
    [],
  );

  const handleOpenBook = useCallback(
    async (book: BookMeta) => {
      pendingOpenControllerRef.current?.abort();
      const controller = new AbortController();
      pendingOpenControllerRef.current = controller;
      try {
        await ensureLocalThenOpen(book, {
          signal: controller.signal,
          refreshBooks: (books) => refreshWorkspaceBooks(ws, books),
          openBook: (localBook) => {
            openBookInWorkspace(localBook, ws, navigate, controller.signal);
          },
        });
      } catch (error) {
        console.error("Failed to download library book before opening:", error);
        toast.error(`Could not download “${book.title}”. Please try again.`);
      }
    },
    [navigate, ws],
  );

  return <LibraryBrowseContent onOpenBook={handleOpenBook} />;
}
