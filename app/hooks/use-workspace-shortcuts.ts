import { useEffect } from "react";
import type { DockviewApi } from "dockview";
import type { Settings } from "~/lib/settings";

const SIDEBAR_TRANSITION_MS = 270;

function isEditableElement(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export interface UseWorkspaceShortcutsParams {
  readonly apiRef: React.MutableRefObject<DockviewApi | null>;
  readonly collapsed: boolean;
  readonly updateSettings: (patch: Partial<Settings>) => void;
}

export function useWorkspaceShortcuts({
  apiRef,
  collapsed,
  updateSettings,
}: UseWorkspaceShortcutsParams) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        updateSettings({ sidebarCollapsed: !collapsed });
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, SIDEBAR_TRANSITION_MS);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, updateSettings]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const api = apiRef.current;
      if (!api) return;

      if (e.metaKey && (e.key === "[" || e.key === "]")) {
        if (isEditableElement()) return;
        const group = api.activeGroup;
        if (!group || group.panels.length < 2) return;
        e.preventDefault();
        const panels = group.panels;
        const activePanel = group.activePanel;
        const currentIndex = activePanel ? panels.indexOf(activePanel) : 0;
        const delta = e.key === "]" ? 1 : -1;
        const nextIndex = (currentIndex + delta + panels.length) % panels.length;
        panels[nextIndex].focus();
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const dirMap: Record<string, "left" | "down" | "up" | "right"> = {
          h: "left",
          j: "down",
          k: "up",
          l: "right",
        };
        const direction = dirMap[e.key];
        if (!direction) return;
        if (isEditableElement()) return;

        const group = api.activeGroup;
        if (!group) return;
        e.preventDefault();

        const currentRect = group.element.getBoundingClientRect();
        const cx = currentRect.left + currentRect.width / 2;
        const cy = currentRect.top + currentRect.height / 2;

        let bestGroup: typeof group | null = null;
        let bestDist = Infinity;

        for (const g of api.groups) {
          if (g === group) continue;
          const r = g.element.getBoundingClientRect();
          const gx = r.left + r.width / 2;
          const gy = r.top + r.height / 2;

          let isCandidate = false;
          let dist = 0;
          switch (direction) {
            case "left":
              isCandidate = gx < cx;
              dist = cx - gx;
              break;
            case "right":
              isCandidate = gx > cx;
              dist = gx - cx;
              break;
            case "up":
              isCandidate = gy < cy;
              dist = cy - gy;
              break;
            case "down":
              isCandidate = gy > cy;
              dist = gy - cy;
              break;
          }

          if (isCandidate && dist < bestDist) {
            bestDist = dist;
            bestGroup = g;
          }
        }

        if (bestGroup) {
          const target = bestGroup.activePanel ?? bestGroup.panels[0];
          if (target) target.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [apiRef]);
}
