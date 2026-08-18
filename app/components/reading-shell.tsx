import { useEffect, useSyncExternalStore } from "react";
import { ReadingRail } from "~/components/reading-shell/reading-rail";
import { ReadingRailTabProvider } from "~/components/reading-shell/reading-rail-tab-context";
import { ReadingSplit } from "~/components/reading-shell/reading-split";
import { WorkspaceBookReader } from "~/components/workspace-book-reader";
import { WorkspacePdfReader } from "~/components/workspace-pdf-reader";
import { ReadingChatMenuProvider } from "~/lib/context/reading-chat-menu-context";
import { useWorkspace } from "~/lib/context/workspace-context";

export function ReadingShell() {
  const workspace = useWorkspace();
  const activeBookId = useSyncExternalStore(
    workspace.subscribeClusterChanges,
    () => workspace.activeClusterBookIdRef.current,
    () => workspace.activeClusterBookIdRef.current,
  );
  const book = workspace.booksRef.current.find((candidate) => candidate.id === activeBookId);

  useEffect(() => {
    const previousTitle = document.title;
    const readerTitle = book?.title ?? "Readmaxxing";
    document.title = readerTitle;

    return () => {
      if (document.title === readerTitle) {
        document.title = previousTitle;
      }
    };
  }, [book?.title]);

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
    <ReadingRailTabProvider>
      <ReadingChatMenuProvider>
        <ReadingSplit book={bookSurface} rail={<ReadingRail />} />
      </ReadingChatMenuProvider>
    </ReadingRailTabProvider>
  );
}
