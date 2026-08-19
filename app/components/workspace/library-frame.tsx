import {
  createContext,
  useContext,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Tabs } from "@base-ui/react/tabs";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import { BugReportDialog } from "~/components/bug-report-dialog";
import { DEFAULT_RAIL_WIDTH } from "~/components/reading-shell/reading-rail-width";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

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
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [headerControlsElement, setHeaderControlsElement] = useState<HTMLDivElement | null>(null);
  const { pathname } = useLocation();

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
            Upload book
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setBugReportOpen(true)}>Bug report</DropdownMenuItem>
        </DropdownMenuGroup>
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
            className="hidden max-w-full shrink-0 items-start gap-3 px-6 text-xs font-normal md:flex md:w-(--library-rail-width)"
            style={{ "--library-rail-width": `${DEFAULT_RAIL_WIDTH}px` } as CSSProperties}
          >
            <nav
              aria-label="Library navigation"
              className="hidden h-7 min-w-0 flex-1 items-center gap-5 md:flex"
            >
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn("relative leading-[18px] text-foreground", {
                      "after:absolute after:bottom-0 after:left-0 after:h-px after:w-[15px] after:bg-foreground":
                        isActive,
                    })
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            {renderActionsMenu()}
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
