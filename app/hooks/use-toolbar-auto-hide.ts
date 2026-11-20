import { useCallback, useEffect, useRef, useState } from "react";

const TOOLBAR_AUTO_HIDE_MS = 3000;

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

  const showToolbar = useCallback(() => {
    setToolbarVisible(true);
    if (shouldAutoHide) resetToolbarTimer();
  }, [shouldAutoHide, resetToolbarTimer]);

  const showToolbarPersistent = useCallback(() => {
    setToolbarVisible(true);
    if (toolbarTimerRef.current) {
      clearTimeout(toolbarTimerRef.current);
      toolbarTimerRef.current = null;
    }
  }, []);

  const toggleToolbar = useCallback(() => {
    setToolbarVisible((prev) => {
      const next = !prev;
      if (next && shouldAutoHide) resetToolbarTimer();
      return next;
    });
  }, [shouldAutoHide, resetToolbarTimer]);

  useEffect(() => {
    if (shouldAutoHide) {
      resetToolbarTimer();
    } else {
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

  return {
    toolbarVisible,
    showToolbar,
    showToolbarPersistent,
    toggleToolbar,
    resetToolbarTimer,
  } as const;
}
