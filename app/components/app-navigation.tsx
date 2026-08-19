import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { DEFAULT_RAIL_WIDTH } from "~/components/reading-shell/reading-rail-width";
import { cn } from "~/lib/utils";

const NAV_ITEMS = [
  { label: "Library", to: "/library" },
  { label: "Free ebooks", to: "/standard-ebooks" },
  { label: "Settings", to: "/settings" },
] as const;

export function AppNavigation({ children }: { readonly children?: ReactNode }) {
  return (
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
              cn("relative leading-[18px] text-muted-foreground hover:text-foreground", {
                "text-foreground": isActive,
                "after:absolute after:bottom-0 after:left-0 after:h-px after:w-[15px] after:bg-foreground":
                  isActive,
              })
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
      {children}
    </nav>
  );
}
