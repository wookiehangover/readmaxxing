import { Columns2, LayoutDashboard, Check } from "lucide-react";
import type { LayoutMode } from "~/lib/settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";

interface LayoutModeSwitcherProps {
  readonly layoutMode: LayoutMode;
  readonly onChange: (mode: LayoutMode) => void;
  /** When true, renders icon-only (e.g. collapsed sidebar). */
  readonly collapsed?: boolean;
}

/**
 * Workspace-level control for switching between focused (default) and
 * freeform layout modes. Both directions apply immediately.
 */
export function LayoutModeSwitcher({
  layoutMode,
  onChange,
  collapsed = false,
}: LayoutModeSwitcherProps) {
  const handleSelect = (next: LayoutMode) => {
    if (next === layoutMode) return;
    onChange(next);
  };

  const Icon = layoutMode === "focused" ? Columns2 : LayoutDashboard;
  const label = layoutMode === "focused" ? "Focused" : "Freeform";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="layout-mode-trigger"
        aria-label={`Layout: ${label}. Click to change.`}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
          { "mx-auto": collapsed },
        )}
      >
        <Icon className="size-4" />
        {!collapsed && <span className="truncate">{label}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Layout mode</DropdownMenuLabel>
          <DropdownMenuItem
            data-testid="layout-mode-focused"
            onClick={() => handleSelect("focused")}
            className="flex items-start gap-2 py-1.5"
          >
            <Columns2 className="mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">Focused</span>
              <span className="text-xs text-muted-foreground">
                One book at a time. Chat and notes stay attached.
              </span>
            </div>
            {layoutMode === "focused" && (
              <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="layout-mode-freeform"
            onClick={() => handleSelect("freeform")}
            className="flex items-start gap-2 py-1.5"
          >
            <LayoutDashboard className="mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">Freeform</span>
              <span className="text-xs text-muted-foreground">
                Drag panels freely. Advanced — no guardrails.
              </span>
            </div>
            {layoutMode === "freeform" && (
              <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
