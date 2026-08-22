import { useEffect } from "react";
import type { Settings } from "~/lib/settings";

const SIDEBAR_TRANSITION_MS = 270;

export interface UseWorkspaceShortcutsParams {
  readonly collapsed: boolean;
  readonly zenMode: boolean;
  readonly updateSettings: (patch: Partial<Settings>) => void;
}

export function useWorkspaceShortcuts({
  collapsed,
  zenMode,
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
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        updateSettings({ zenMode: !zenMode });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, zenMode, updateSettings]);
}
