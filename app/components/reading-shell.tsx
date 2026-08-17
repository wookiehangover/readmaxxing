import { useSyncExternalStore } from "react";
import { ReadingRail } from "~/components/reading-shell/reading-rail";
import { WorkspaceBookReader } from "~/components/workspace-book-reader";
import { WorkspacePdfReader } from "~/components/workspace-pdf-reader";
import { useWorkspace } from "~/lib/context/workspace-context";

export function ReadingShell() {
  const workspace = useWorkspace();
  const activeBookId = useSyncExternalStore(
    workspace.subscribeClusterChanges,
    () => workspace.activeClusterBookIdRef.current,
    () => workspace.activeClusterBookIdRef.current,
  );
  const book = workspace.booksRef.current.find((candidate) => candidate.id === activeBookId);

  return (
    <div className="flex h-full min-h-0 bg-background" data-testid="reading-shell">
      <main className="min-w-0 flex-1 outline-none" aria-label="Book surface" tabIndex={-1}>
        {book ? (
          book.format === "pdf" ? (
            <WorkspacePdfReader bookId={book.id} />
          ) : (
            <WorkspaceBookReader bookId={book.id} panelTypography={{ readerLayout: "spread" }} />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Open a book from the library to start reading.
          </div>
        )}
      </main>
      <aside
        className="hidden w-96 shrink-0 border-l border-border bg-background md:block"
        aria-label="Reading rail"
      >
        <ReadingRail />
      </aside>
    </div>
  );
}
