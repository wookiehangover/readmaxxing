import { useSyncExternalStore } from "react";
import { ReadingRail } from "~/components/reading-shell/reading-rail";
import { ReadingSplit } from "~/components/reading-shell/reading-split";
import { WorkspaceBookReader } from "~/components/workspace-book-reader";
import { WorkspacePdfReader } from "~/components/workspace-pdf-reader";
import { useIsMobile } from "~/hooks/use-mobile";
import { ReadingChatMenuProvider } from "~/lib/context/reading-chat-menu-context";
import { useWorkspace } from "~/lib/context/workspace-context";

export function ReadingShell() {
  const workspace = useWorkspace();
  const isMobile = useIsMobile();
  const activeBookId = useSyncExternalStore(
    workspace.subscribeClusterChanges,
    () => workspace.activeClusterBookIdRef.current,
    () => workspace.activeClusterBookIdRef.current,
  );
  const book = workspace.booksRef.current.find((candidate) => candidate.id === activeBookId);

  const bookSurface = book ? (
    book.format === "pdf" ? (
      <WorkspacePdfReader bookId={book.id} />
    ) : (
      <WorkspaceBookReader bookId={book.id} panelTypography={{ readerLayout: "spread" }} />
    )
  ) : (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      Open a book from the library to start reading.
    </div>
  );

  return (
    <ReadingChatMenuProvider>
      {isMobile === true ? (
        <ReadingRail mobile bookSurface={bookSurface} />
      ) : (
        <ReadingSplit book={bookSurface} rail={<ReadingRail />} />
      )}
    </ReadingChatMenuProvider>
  );
}
