import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { TocList } from "~/components/book-list";
import { ChatPanel } from "~/components/chat/chat-panel";
import {
  getRememberedMobileReadingTab,
  MOBILE_READING_TAB_EVENT,
  MOBILE_READING_TABS,
  rememberMobileReadingTab,
  type MobileReadingTab,
} from "~/components/reading-shell/mobile-reading-tabs";
import { ReadingDetailsPanel } from "~/components/reading-shell/reading-details-panel";
import { READING_RAIL_MENU_ID } from "~/components/reading-shell/reading-rail-menu-portal";
import {
  useReadingRailTab,
  type ReadingRailTab,
} from "~/components/reading-shell/reading-rail-tab-context";
import { Button } from "~/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { WorkspaceOutlinePanel } from "~/components/workspace/outline-panel";
import { WorkspaceNotebookPanel } from "~/components/workspace/panel-components";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useAppStore } from "~/lib/themis/provider";
import { cn } from "~/lib/utils";

const desktopTabs = ["Notes", "Discuss", "Outline"] as const;

export function ReadingRail({
  mobile = false,
  bookSurface,
}: {
  mobile?: boolean;
  bookSurface?: ReactNode;
}) {
  const workspace = useWorkspace();
  const store = useAppStore();
  const { activeTab, setActiveTab } = useReadingRailTab();
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
  const [tocOpen, setTocOpen] = useState(false);
  const book = store.booksSelectors.selectBookById.useValue(activeBookId ?? "");
  const toc = activeBookId ? workspace.findTocForBook(activeBookId) : undefined;
  const navigateToToc = activeBookId ? workspace.findTocNavigationForBook(activeBookId) : undefined;
  const chapterLabel = location?.chapterLabel;
  const hasTocShortcut = Boolean(chapterLabel && toc?.length && navigateToToc);
  const visibleDesktopTabs =
    activeTab === "Details" ? ([...desktopTabs, "Details"] as const) : desktopTabs;

  useEffect(() => {
    const rememberedTab = getRememberedMobileReadingTab(activeBookId);
    if (mobile) setActiveTab(rememberedTab ?? "Read");
    else if (rememberedTab && rememberedTab !== "Read") setActiveTab(rememberedTab);
    const handleOpenTab = (event: Event) => {
      const tab = (event as CustomEvent<MobileReadingTab>).detail;
      if (mobile) rememberMobileReadingTab(activeBookId, tab);
      setActiveTab(tab);
    };
    window.addEventListener(MOBILE_READING_TAB_EVENT, handleOpenTab);
    return () => window.removeEventListener(MOBILE_READING_TAB_EVENT, handleOpenTab);
  }, [activeBookId, mobile, setActiveTab]);

  const panels = book ? (
    <>
      <Tabs.Panel value="Notes" className="min-h-0 flex-1 overflow-hidden outline-none">
        <WorkspaceNotebookPanel bookId={book.id} bookTitle={book.title} chromeless />
      </Tabs.Panel>
      <Tabs.Panel value="Discuss" className="min-h-0 flex-1 overflow-hidden outline-none">
        <ChatPanel bookId={book.id} bookTitle={book.title} />
      </Tabs.Panel>
      <Tabs.Panel value="Outline" className="min-h-0 flex-1 overflow-hidden outline-none">
        <WorkspaceOutlinePanel bookId={book.id} bookTitle={book.title} chromeless />
      </Tabs.Panel>
      <Tabs.Panel value="Details" className="min-h-0 flex-1 overflow-hidden outline-none">
        <ReadingDetailsPanel book={book} mobile={mobile} />
      </Tabs.Panel>
      <Tabs.Panel value="Review" className="min-h-0 flex-1 overflow-hidden outline-none">
        <Empty className="h-full pr-6">
          <EmptyHeader>
            <EmptyTitle>Nothing to review yet.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </Tabs.Panel>
    </>
  ) : null;

  if (mobile) {
    return (
      <Tabs.Root
        className="flex h-full min-h-0 flex-col bg-background"
        value={activeTab}
        onValueChange={(value) => {
          const tab = value as MobileReadingTab;
          rememberMobileReadingTab(activeBookId, tab);
          setActiveTab(tab);
        }}
        data-testid="mobile-reading-tabs"
      >
        <Tabs.Panel
          value="Read"
          keepMounted
          aria-label="Book surface"
          className="min-h-0 flex-1 overflow-hidden outline-none"
        >
          {bookSurface}
        </Tabs.Panel>
        {panels}
        <div className="flex shrink-0 items-start gap-3 bg-background px-6 pt-3 pb-3">
          <Tabs.List
            aria-label="Reading sections"
            className="relative flex min-w-0 flex-1 items-center gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {MOBILE_READING_TABS.map((tab) => (
              <Tabs.Tab
                key={tab}
                value={tab}
                className={cn(
                  "relative h-7 shrink-0 bg-transparent p-0 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  {
                    "text-foreground": activeTab === tab,
                  },
                )}
              >
                {tab}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator className="absolute bottom-0 left-[var(--active-tab-left)] h-px w-3 bg-foreground transition-[left] duration-200 ease-out motion-reduce:transition-none" />
          </Tabs.List>
          <div id={READING_RAIL_MENU_ID} className="flex min-h-7 shrink-0 items-center" />
        </div>
      </Tabs.Root>
    );
  }

  return (
    <Tabs.Root
      className="flex h-full min-h-0 flex-col pl-6 py-5"
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as ReadingRailTab)}
    >
      <div className="flex items-start gap-3 pr-6">
        <Tabs.List
          aria-label="Reading tools"
          className="relative flex min-w-0 flex-1 items-center gap-5"
        >
          {visibleDesktopTabs.map((tab) => (
            <Tabs.Tab
              key={tab}
              value={tab}
              className={cn(
                "relative h-7 shrink-0 bg-transparent p-0 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                {
                  "text-foreground": activeTab === tab,
                },
              )}
            >
              {tab}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator
            data-testid="rail-tab-indicator"
            className="absolute bottom-0 left-[var(--active-tab-left)] h-px w-3 bg-foreground transition-[left] duration-200 ease-out motion-reduce:transition-none"
          />
        </Tabs.List>
        <div id={READING_RAIL_MENU_ID} className="flex min-h-7 shrink-0 items-center" />
      </div>

      <div className="min-h-12 py-3 pr-6 text-xs">
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

      {panels}
    </Tabs.Root>
  );
}
