import { useEffect } from "react";
import type { DockviewPanelApi } from "dockview-react";
import { injectThemeColors, registerThemeColors } from "~/lib/epub/epub-theme-utils";
import type { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";

interface UseEpubPanelSyncOptions {
  panelApi?: DockviewPanelApi;
  containerRef: React.RefObject<HTMLDivElement | null>;
  renditionRef: React.RefObject<SuccessorRenditionAdapter | null>;
  resolvedTheme: "light" | "dark";
  flushPositionSave: () => void;
  markLayoutChangeInProgress: () => void;
}

export function useEpubPanelSync({
  panelApi,
  containerRef,
  renditionRef,
  resolvedTheme,
  flushPositionSave,
  markLayoutChangeInProgress,
}: UseEpubPanelSyncOptions) {
  useEffect(() => {
    if (!panelApi) return;

    const applyTheme = () => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      registerThemeColors(rendition);
      injectThemeColors(rendition, resolvedTheme);
      rendition.themes.select(resolvedTheme);
    };

    const readContainerSize = (): { width: number; height: number } | null => {
      const element = containerRef.current;
      if (!element) return null;
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    };

    let lastSize = readContainerSize();
    const resizeIfNeeded = (force: boolean) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const nextSize = readContainerSize();
      if (!nextSize) return;
      if (
        !force &&
        lastSize &&
        Math.abs(nextSize.width - lastSize.width) < 1 &&
        Math.abs(nextSize.height - lastSize.height) < 1
      ) {
        return;
      }
      lastSize = nextSize;
      try {
        (rendition as { resize?: () => void }).resize?.();
      } catch {
        // The rendition manager may not be initialized yet.
      }
    };

    const visibilityDisposable = panelApi.onDidVisibilityChange((event) => {
      if (event.isVisible) {
        markLayoutChangeInProgress();
        applyTheme();
        requestAnimationFrame(() => resizeIfNeeded(true));
      } else {
        flushPositionSave();
      }
    });
    const activeDisposable = panelApi.onDidActiveChange((event) => {
      if (event.isActive) applyTheme();
    });

    let resizeAnimationFrame: number | null = null;
    const dimensionsDisposable = panelApi.onDidDimensionsChange(() => {
      if (!renditionRef.current) return;
      markLayoutChangeInProgress();
      if (resizeAnimationFrame !== null) cancelAnimationFrame(resizeAnimationFrame);
      resizeAnimationFrame = requestAnimationFrame(() => {
        resizeAnimationFrame = null;
        resizeIfNeeded(false);
      });
    });

    return () => {
      visibilityDisposable.dispose();
      activeDisposable.dispose();
      dimensionsDisposable.dispose();
      if (resizeAnimationFrame !== null) cancelAnimationFrame(resizeAnimationFrame);
    };
  }, [
    containerRef,
    flushPositionSave,
    markLayoutChangeInProgress,
    panelApi,
    renditionRef,
    resolvedTheme,
  ]);
}
