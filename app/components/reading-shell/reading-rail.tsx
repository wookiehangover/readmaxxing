import { useState, useSyncExternalStore } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { TocList } from "~/components/book-list";
import { ChatPanel } from "~/components/chat/chat-panel";
import { READING_RAIL_MENU_ID } from "~/components/reading-shell/reading-rail-menu-portal";
import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { WorkspaceOutlinePanel } from "~/components/workspace/outline-panel";
import { WorkspaceNotebookPanel } from "~/components/workspace/panel-components";
import { useWorkspace } from "~/lib/context/workspace-context";
import { cn } from "~/lib/utils";

const tabs = ["Notes", "Discuss", "Outline", "Review"] as const;
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
  const [tocOpen, setTocOpen] = useState(false);
  const book = workspace.booksRef.current.find((candidate) => candidate.id === activeBookId);
  const toc = activeBookId ? workspace.findTocForBook(activeBookId) : undefined;
  const navigateToToc = activeBookId ? workspace.findTocNavigationForBook(activeBookId) : undefined;
  const chapterLabel = location?.chapterLabel;
  const hasTocShortcut = Boolean(chapterLabel && toc?.length && navigateToToc);

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
                  "text-foreground after:absolute after:bottom-0 after:left-0 after:h-px after:w-3 after:bg-foreground":
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
          <span>{book?.title}</span>
          {chapterLabel ? (
            <>
              {" · "}
              {hasTocShortcut && toc && navigateToToc ? (
                <Popover open={tocOpen} onOpenChange={setTocOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="ghost"
                        className="h-auto rounded-sm p-0 text-xs font-normal hover:bg-transparent hover:underline"
                        aria-label={`Open table of contents, current chapter ${chapterLabel}`}
                      />
                    }
                  >
                    {chapterLabel}
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={8}
                    className="max-h-80 w-64 overflow-y-auto p-1.5"
                  >
                    <PopoverTitle className="px-2 py-1 text-xs text-muted-foreground">
                      Table of Contents
                    </PopoverTitle>
                    <ul>
                      <TocList
                        entries={toc}
                        onNavigate={(href) => {
                          navigateToToc(href);
                          setTocOpen(false);
                        }}
                      />
                    </ul>
                  </PopoverContent>
                </Popover>
              ) : (
                chapterLabel
              )}
            </>
          ) : null}
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
          <Tabs.Panel value="Discuss" className="min-h-0 flex-1 overflow-hidden outline-none">
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
