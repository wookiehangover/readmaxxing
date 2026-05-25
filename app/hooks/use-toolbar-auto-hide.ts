import { useCallback, useEffect, useRef, useState } from "react";

/** Auto-hide delay for mobile and zen mode toolbar (ms) */
const TOOLBAR_AUTO_HIDE_MS = 3000;

/**
 * Manages toolbar auto-hide behavior.
 *
 * On mobile and in zen mode, the toolbar auto-hides after a delay. On desktop it stays visible.
 */
export function useToolbarAutoHide(isMobile: boolean, zenMode = false) {
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoHide = isMobile || zenMode;

  const resetToolbarTimer = useCallback(() => {
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    toolbarTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
    }, TOOLBAR_AUTO_HIDE_MS);
  }, []);

  /** Show toolbar and start auto-hide countdown when auto-hide is enabled */
  const showToolbar = useCallback(() => {
    setToolbarVisible(true);
    if (shouldAutoHide) resetToolbarTimer();
  }, [shouldAutoHide, resetToolbarTimer]);

  /** Toggle toolbar visibility (for center-tap on mobile) */
  const toggleToolbar = useCallback(() => {
    setToolbarVisible((prev) => {
      const next = !prev;
      if (next && shouldAutoHide) resetToolbarTimer();
      return next;
    });
  }, [shouldAutoHide, resetToolbarTimer]);

  // Start auto-hide timer on mount for mobile or zen mode
  useEffect(() => {
    if (shouldAutoHide) {
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
  }, [shouldAutoHide, resetToolbarTimer]);

  return { toolbarVisible, showToolbar, toggleToolbar, resetToolbarTimer } as const;
}
