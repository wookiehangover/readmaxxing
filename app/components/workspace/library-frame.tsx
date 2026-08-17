import { useState, type ChangeEvent, type MutableRefObject, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { NavLink } from "react-router";
import { BugReportDialog } from "~/components/bug-report-dialog";
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

interface LibraryFrameProps {
  readonly children: ReactNode;
  readonly fileInputRef: MutableRefObject<HTMLInputElement | null>;
  readonly onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function LibraryFrame({ children, fileInputRef, onFileInput }: LibraryFrameProps) {
  const [bugReportOpen, setBugReportOpen] = useState(false);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-end px-4 md:px-6">
        <nav
          aria-label="Library navigation"
          className="flex items-center gap-5 text-xs font-normal"
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
  );
}
