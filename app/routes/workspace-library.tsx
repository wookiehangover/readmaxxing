import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { useWorkspace, type WorkspaceContextValue } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

type WorkspaceBookRefs = Pick<WorkspaceContextValue, "dockviewApi" | "openBookRef">;
type FrameScheduler = (callback: FrameRequestCallback) => number;
interface OpenBookOptions {
  signal?: AbortSignal;
  scheduleFrame?: FrameScheduler;
  maxFrames?: number;
  isWorkspaceActive?: () => boolean;
}

const MAX_READY_FRAMES = 120;

export function openBookInWorkspace(
  book: BookMeta,
  navigate: (path: string) => void | Promise<void>,
  workspace: WorkspaceBookRefs,
  {
    signal,
    scheduleFrame = window.requestAnimationFrame,
    maxFrames = MAX_READY_FRAMES,
    isWorkspaceActive = () => true,
  }: OpenBookOptions = {},
) {
  navigate("/");

  let frameCount = 0;
  const openWhenReady: FrameRequestCallback = () => {
    if (signal?.aborted || !isWorkspaceActive()) return;

    frameCount += 1;
    if (!workspace.dockviewApi.current) {
      if (frameCount < maxFrames) scheduleFrame(openWhenReady);
      return;
    }
    workspace.openBookRef.current?.(book);
  };
  if (maxFrames > 0 && !signal?.aborted) scheduleFrame(openWhenReady);
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
