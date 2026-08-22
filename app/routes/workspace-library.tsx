import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Route } from "./+types/workspace-library";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { useWorkspace, type WorkspaceContextValue } from "~/lib/context/workspace-context";
import { ensureLocalThenOpen } from "~/lib/library-book-open";
import { getReadingBookId } from "~/lib/reading-route";
import type { BookMeta } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";

type WorkspaceBookRefs = Pick<WorkspaceContextValue, "openBookRef">;

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Library — Readmaxxing" }];
}

export function openBookInWorkspace(
  book: BookMeta,
  workspace: WorkspaceBookRefs,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return;
  workspace.openBookRef.current?.(book);
}

export default function WorkspaceLibraryRoute() {
  const ws = useWorkspace();
  const store = useAppStore();
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
          store,
          openBook: (localBook) => {
            openBookInWorkspace(localBook, ws, controller.signal);
          },
        });
      } catch (error) {
        console.error("Failed to download library book before opening:", error);
        toast.error(`Could not download “${book.title}”. Please try again.`);
      }
    },
    [store, ws],
  );

  return <LibraryBrowseContent onOpenBook={handleOpenBook} />;
}
