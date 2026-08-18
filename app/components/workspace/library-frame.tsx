import {
  createContext,
  useContext,
  useState,
  type ChangeEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { NavLink } from "react-router";
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

  return (
    <LibraryHeaderControlsContext.Provider value={headerControlsElement}>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 py-5">
          <div
            ref={setHeaderControlsElement}
            data-slot="library-header-controls"
            className="flex min-w-0 flex-1 items-center"
          />
          <nav
            aria-label="Library navigation"
            className="flex shrink-0 items-start gap-3 px-6 text-xs font-normal"
            style={{ width: DEFAULT_RAIL_WIDTH, maxWidth: "100%" }}
          >
            <div className="flex h-7 min-w-0 flex-1 items-center gap-5">
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
            </div>
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
                  <DropdownMenuItem onClick={() => setBugReportOpen(true)}>
                    Bug report
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
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
        <BugReportDialog open={bugReportOpen} onOpenChange={setBugReportOpen} hideTrigger />
      </div>
    </LibraryHeaderControlsContext.Provider>
  );
}
