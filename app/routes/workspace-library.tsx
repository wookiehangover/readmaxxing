import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { useWorkspace, type WorkspaceContextValue } from "~/lib/context/workspace-context";
import { ensureLocalThenOpen, refreshWorkspaceBooks } from "~/lib/library-book-open";
import type { BookMeta } from "~/lib/stores/book-store";

type WorkspaceBookRefs = Pick<WorkspaceContextValue, "openBookRef">;
type FrameScheduler = (callback: FrameRequestCallback) => number;
interface OpenBookOptions {
  signal?: AbortSignal;
  scheduleFrame?: FrameScheduler;
  isWorkspaceActive?: () => boolean;
}

export function openBookInWorkspace(
  book: BookMeta,
  navigate: (path: string) => void | Promise<void>,
  workspace: WorkspaceBookRefs,
  {
    signal,
    scheduleFrame = window.requestAnimationFrame,
    isWorkspaceActive = () => true,
  }: OpenBookOptions = {},
) {
  if (signal?.aborted) return;
  navigate("/");

  const handOffOpen: FrameRequestCallback = () => {
    if (signal?.aborted || !isWorkspaceActive()) return;
    workspace.openBookRef.current?.(book);
  };
  if (!signal?.aborted) scheduleFrame(handOffOpen);
}

export default function WorkspaceLibraryRoute() {
  const navigate = useNavigate();
  const ws = useWorkspace();
  const pendingOpenControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      // Preserve the intended /library → / handoff; otherwise abort the pending open
      // when leaving the library route.
      if (window.location.pathname !== "/") pendingOpenControllerRef.current?.abort();
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
            openBookInWorkspace(localBook, navigate, ws, {
              signal: controller.signal,
              isWorkspaceActive: () => window.location.pathname === "/",
            });
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
