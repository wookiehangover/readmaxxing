import { useCallback } from "react";
import { useNavigate } from "react-router";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";
import { useWorkspace, type WorkspaceContextValue } from "~/lib/context/workspace-context";
import type { BookMeta } from "~/lib/stores/book-store";

type WorkspaceBookRefs = Pick<WorkspaceContextValue, "dockviewApi" | "openBookRef">;
type FrameScheduler = (callback: FrameRequestCallback) => number;

export function openBookInWorkspace(
  book: BookMeta,
  navigate: (path: string) => void | Promise<void>,
  workspace: WorkspaceBookRefs,
  scheduleFrame: FrameScheduler = window.requestAnimationFrame,
) {
  navigate("/");

  const openWhenReady: FrameRequestCallback = () => {
    if (!workspace.dockviewApi.current) {
      scheduleFrame(openWhenReady);
      return;
    }
    workspace.openBookRef.current?.(book);
  };
  scheduleFrame(openWhenReady);
}

export default function WorkspaceLibraryRoute() {
  const navigate = useNavigate();
  const ws = useWorkspace();

  const handleOpenBook = useCallback(
    (book: BookMeta) => {
      openBookInWorkspace(book, navigate, ws);
    },
    [navigate, ws],
  );

  return <LibraryBrowseContent onOpenBook={handleOpenBook} />;
}
