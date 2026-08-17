import { useState, useSyncExternalStore } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { ChatPanel } from "~/components/chat/chat-panel";
import { READING_RAIL_MENU_ID } from "~/components/reading-shell/reading-rail-menu-portal";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { WorkspaceOutlinePanel } from "~/components/workspace/outline-panel";
import { WorkspaceNotebookPanel } from "~/components/workspace/panel-components";
import { useWorkspace } from "~/lib/context/workspace-context";
import { cn } from "~/lib/utils";

const tabs = ["Notes", "Chat", "Outline", "Review"] as const;
type ReadingRailTab = (typeof tabs)[number];

export function ReadingRail() {
  const workspace = useWorkspace();
  const activeBookId = useSyncExternalStore(
    workspace.subscribeClusterChanges,
    () => workspace.activeClusterBookIdRef.current,
    () => workspace.activeClusterBookIdRef.current,
  );
  const location = useSyncExternalStore(
    workspace.subscribeReadingLocations,
    () => workspace.getReadingLocation(activeBookId),
    () => null,
  );
  const [activeTab, setActiveTab] = useState<ReadingRailTab>("Notes");
  const book = workspace.booksRef.current.find((candidate) => candidate.id === activeBookId);

  return (
    <Tabs.Root
      className="flex h-full min-h-0 flex-col px-6 py-5"
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as ReadingRailTab)}
    >
      <div className="flex items-start gap-3">
        <Tabs.List aria-label="Reading tools" className="flex min-w-0 flex-1 items-center gap-5">
          {tabs.map((tab) => (
            <Tabs.Tab
              key={tab}
              value={tab}
              className={cn(
                "relative h-7 shrink-0 bg-transparent p-0 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                {
                  "text-foreground after:absolute after:bottom-0 after:left-1/2 after:h-px after:w-3 after:-translate-x-1/2 after:bg-foreground":
                    activeTab === tab,
                },
              )}
            >
              {tab}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <div id={READING_RAIL_MENU_ID} className="flex min-h-7 shrink-0 items-center" />
      </div>

      <div className="min-h-12 py-3 text-xs">
        <p className="truncate text-foreground">
          {book?.title}
          {location?.chapterLabel ? ` · ${location.chapterLabel}` : null}
        </p>
        {location && location.currentPage !== null && location.totalPages !== null ? (
          <p className="text-muted-foreground tabular-nums">
            {location.currentPage} / {location.totalPages}
          </p>
        ) : null}
      </div>

      {book ? (
        <>
          <Tabs.Panel value="Notes" className="min-h-0 flex-1 overflow-hidden outline-none">
            <WorkspaceNotebookPanel bookId={book.id} bookTitle={book.title} chromeless />
          </Tabs.Panel>
          <Tabs.Panel value="Chat" className="min-h-0 flex-1 overflow-hidden outline-none">
            <ChatPanel bookId={book.id} bookTitle={book.title} />
          </Tabs.Panel>
          <Tabs.Panel value="Outline" className="min-h-0 flex-1 overflow-hidden outline-none">
            <WorkspaceOutlinePanel bookId={book.id} bookTitle={book.title} />
          </Tabs.Panel>
          <Tabs.Panel value="Review" className="min-h-0 flex-1 overflow-hidden outline-none">
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>Nothing to review yet.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          </Tabs.Panel>
        </>
      ) : null}
    </Tabs.Root>
  );
}
