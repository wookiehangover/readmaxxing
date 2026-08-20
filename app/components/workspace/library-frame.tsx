import {
  createContext,
  useContext,
  useState,
  type ChangeEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Tabs } from "@base-ui/react/tabs";
import { createPortal } from "react-dom";
import { Bug, MoreHorizontal, Upload } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { AppNavigation } from "~/components/app-navigation";
import { BugReportDialog } from "~/components/bug-report-dialog";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { getBookReadingPath } from "~/lib/reading-route";
import { useAppStore } from "~/lib/themis/provider";
import { cn } from "~/lib/utils";
import { sortBooks } from "~/lib/workspace-utils";

const NAV_ITEMS = [
  { label: "Library", to: "/library" },
  { label: "Free ebooks", to: "/standard-ebooks" },
  { label: "Settings", to: "/settings" },
] as const;

const LibraryHeaderControlsContext = createContext<HTMLElement | null | undefined>(undefined);

export function LibraryHeaderControls({ children }: { readonly children: ReactNode }) {
  const container = useContext(LibraryHeaderControlsContext);
  if (container === undefined) return children;
  return container ? createPortal(children, container) : null;
}

interface LibraryFrameProps {
  readonly children: ReactNode;
  readonly fileInputRef: MutableRefObject<HTMLInputElement | null>;
  readonly onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function LibraryFrame({ children, fileInputRef, onFileInput }: LibraryFrameProps) {
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks.useValue();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [headerControlsElement, setHeaderControlsElement] = useState<HTMLDivElement | null>(null);
  const lastOpenedMap = store.workspaceRestoreSelectors.selectLastOpenedMap.useValue();
  const recentBooks = sortBooks(
    books.filter((book) => lastOpenedMap.has(book.id)),
    "recent",
    lastOpenedMap,
  ).slice(0, 5);

  const renderActionsMenu = () => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" title="More library actions" />}
      >
        <MoreHorizontal />
        <span className="sr-only">More library actions</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 text-xs">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <Upload />
            Upload book
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setBugReportOpen(true)}>
            <Bug />
            Bug report
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {recentBooks.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent</DropdownMenuLabel>
              {recentBooks.map((book) => (
                <DropdownMenuItem
                  key={book.id}
                  onClick={() => navigate(getBookReadingPath(book.id))}
                >
                  <span className="min-w-0 truncate" title={book.title}>
                    {book.title}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <LibraryHeaderControlsContext.Provider value={headerControlsElement}>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 py-5">
          <div
            ref={setHeaderControlsElement}
            data-slot="library-header-controls"
            className="flex min-w-0 flex-1 items-center"
          />
          <div
            data-slot="library-header-navigation"
            className="hidden max-w-full shrink-0 md:block"
          >
            <AppNavigation>{renderActionsMenu()}</AppNavigation>
          </div>
        </header>
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub,.pdf"
          multiple
          className="hidden"
          onChange={onFileInput}
        />
        <div className="min-h-0 flex-1">{children}</div>
        <nav
          aria-label="Library navigation"
          data-slot="library-mobile-navigation"
          className="shrink-0 bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <Tabs.Root value={pathname} className="flex min-w-0 items-start gap-3">
            <Tabs.List className="relative flex min-w-0 flex-1 items-center gap-5">
              {NAV_ITEMS.map((item) => (
                <Tabs.Tab
                  key={item.to}
                  value={item.to}
                  nativeButton={false}
                  render={<NavLink to={item.to} />}
                  className={cn(
                    "relative h-7 shrink-0 bg-transparent p-0 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    {
                      "text-foreground": pathname === item.to,
                    },
                  )}
                >
                  {item.label}
                </Tabs.Tab>
              ))}
              <Tabs.Indicator className="absolute bottom-0 left-[var(--active-tab-left)] h-px w-3 bg-foreground transition-[left] duration-200 ease-out motion-reduce:transition-none" />
            </Tabs.List>
            <div className="flex min-h-7 shrink-0 items-center">{renderActionsMenu()}</div>
          </Tabs.Root>
        </nav>
        <BugReportDialog open={bugReportOpen} onOpenChange={setBugReportOpen} hideTrigger />
      </div>
    </LibraryHeaderControlsContext.Provider>
  );
}
