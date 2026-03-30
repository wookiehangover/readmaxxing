import { useCallback, useEffect, useRef, useState } from "react";

/** Auto-hide delay for mobile toolbar (ms) */
const TOOLBAR_AUTO_HIDE_MS = 3000;

/**
 * Manages mobile toolbar auto-hide behavior.
 *
 * On mobile, the toolbar auto-hides after a delay. On desktop it stays visible.
 */
export function useToolbarAutoHide(isMobile: boolean) {
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetToolbarTimer = useCallback(() => {
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    toolbarTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
    }, TOOLBAR_AUTO_HIDE_MS);
  }, []);

  /** Show toolbar and start auto-hide countdown (mobile only) */
  const showToolbar = useCallback(() => {
    setToolbarVisible(true);
    if (isMobile) resetToolbarTimer();
  }, [isMobile, resetToolbarTimer]);

  /** Toggle toolbar visibility (for center-tap on mobile) */
  const toggleToolbar = useCallback(() => {
    setToolbarVisible((prev) => {
      const next = !prev;
      if (next && isMobile) resetToolbarTimer();
      return next;
    });
  }, [isMobile, resetToolbarTimer]);

  // Start auto-hide timer on mount for mobile
  useEffect(() => {
    if (isMobile) {
      resetToolbarTimer();
    } else {
      // On desktop, ensure toolbar is always visible
      setToolbarVisible(true);
      if (toolbarTimerRef.current) {
        clearTimeout(toolbarTimerRef.current);
        toolbarTimerRef.current = null;
      }
    }
    return () => {
      if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    };
  }, [isMobile, resetToolbarTimer]);

  return { toolbarVisible, showToolbar, toggleToolbar } as const;
}
