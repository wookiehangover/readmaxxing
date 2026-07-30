import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { useWorkspace, type WorkspaceContextValue } from "~/lib/context/workspace-context";
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
      // Preserve the intended /library → / handoff. Once there, the route
      // predicate and frame limit still stop polling if the user leaves again.
      if (window.location.pathname !== "/") pendingOpenControllerRef.current?.abort();
    },
    [],
  );

  const handleOpenBook = useCallback(
    (book: BookMeta) => {
      pendingOpenControllerRef.current?.abort();
      const controller = new AbortController();
      pendingOpenControllerRef.current = controller;
      openBookInWorkspace(book, navigate, ws, {
        signal: controller.signal,
        isWorkspaceActive: () => window.location.pathname === "/",
      });
    },
    [navigate, ws],
  );

  return <LibraryBrowseContent onOpenBook={handleOpenBook} />;
}
