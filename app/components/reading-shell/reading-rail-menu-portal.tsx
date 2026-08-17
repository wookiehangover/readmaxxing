import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const READING_RAIL_MENU_ID = "reading-rail-menu";

export function ReadingRailMenuPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(READING_RAIL_MENU_ID));
  }, []);

  return target ? createPortal(children, target) : null;
}
