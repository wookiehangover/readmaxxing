import { addPageSwipeRecognizer } from "~/hooks/page-swipe-recognizer";

interface EpubContentSource {
  readonly navigator?: {
    beginInteractivePageTurn(direction: "previous" | "next"): boolean;
    updateInteractivePageTurn(displacement: number): boolean;
    endInteractivePageTurn(commit: boolean): Promise<boolean>;
    cancelInteractivePageTurn(): Promise<boolean>;
  };
  readonly hooks: {
    readonly content: {
      register(callback: (content: { readonly document: Document }) => void): void;
    };
  };
}

interface EpubContentInteractionsOptions {
  readonly isPageSwipingEnabled: () => boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToggleToolbar: () => void;
  readonly onInteractiveNavigationStart?: () => void;
  readonly onInteractiveNavigationAbort?: () => void;
}

interface InteractiveNavigationLifecycle {
  abortPending(): void;
  commit(navigation: () => Promise<boolean>): void;
}

const INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, summary, [contenteditable], [role='button']";

function hasSelectedText(document: Document): boolean {
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || !("closest" in target) || typeof target.closest !== "function") return false;
  return Boolean((target as Element).closest(INTERACTIVE_SELECTOR));
}

function publicationTapBounds(document: Document, viewportWidth: number) {
  const style = document.defaultView?.getComputedStyle(document.body) ?? document.body.style;
  const left = Number.parseFloat(style?.paddingLeft ?? "0");
  const right = Number.parseFloat(style?.paddingRight ?? "0");
  const insetLeft = Number.isFinite(left) ? left : 0;
  const insetRight = Number.isFinite(right) ? right : 0;
  return {
    start: insetLeft,
    width: Math.max(0, viewportWidth - insetLeft - insetRight),
  };
}

function addDocumentInteractions(
  document: Document,
  source: EpubContentSource,
  options: EpubContentInteractionsOptions,
  interactiveNavigation: InteractiveNavigationLifecycle,
): () => void {
  let interactiveTurn = false;
  let suppressNextClick = false;
  let suppressionTimer: ReturnType<typeof setTimeout> | null = null;
  const suppressSyntheticClick = () => {
    suppressNextClick = true;
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = setTimeout(() => {
      suppressNextClick = false;
      suppressionTimer = null;
    }, 500);
  };
  const runSwipe = (callback: () => void) => {
    if (!options.isPageSwipingEnabled()) return;
    suppressSyntheticClick();
    callback();
  };
  const removeSwipeRecognizer = addPageSwipeRecognizer(document, {
    getSelection: () => document.getSelection(),
    shouldStart: (event) => !isInteractiveTarget(event.target),
    onStart: ({ direction }) => {
      if (!options.isPageSwipingEnabled()) return;
      suppressSyntheticClick();
      interactiveNavigation.abortPending();
      interactiveTurn = source.navigator?.beginInteractivePageTurn(direction) ?? false;
    },
    onProgress: ({ displacement }) => {
      if (interactiveTurn) source.navigator?.updateInteractivePageTurn(displacement);
    },
    onRelease: ({ direction, displacement, intent }) => {
      if (interactiveTurn) {
        interactiveTurn = false;
        source.navigator?.updateInteractivePageTurn(displacement);
        const navigator = source.navigator;
        if (!navigator) return;
        if (intent === "complete") {
          interactiveNavigation.commit(() => navigator.endInteractivePageTurn(true));
        } else {
          void navigator.endInteractivePageTurn(false).catch(() => {});
        }
        return;
      }
      if (intent !== "complete") return;
      runSwipe(direction === "next" ? options.onNext : options.onPrevious);
    },
    onCancel: () => {
      if (!interactiveTurn) return;
      interactiveTurn = false;
      void source.navigator?.cancelInteractivePageTurn().catch(() => {});
    },
  });
  const handleClick = (event: MouseEvent) => {
    if (!options.isPageSwipingEnabled()) return;
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (event.button !== 0 || hasSelectedText(document) || isInteractiveTarget(event.target))
      return;
    const width = document.documentElement.clientWidth || document.defaultView?.innerWidth || 0;
    if (!width) return;
    const bounds = publicationTapBounds(document, width);
    const x = event.clientX - bounds.start;
    if (x < 0 || x > bounds.width) return;
    if (x < bounds.width / 4) options.onPrevious();
    else if (x > (bounds.width * 3) / 4) options.onNext();
    else options.onToggleToolbar();
  };
  document.addEventListener("click", handleClick);

  return () => {
    removeSwipeRecognizer();
    document.removeEventListener("click", handleClick);
    if (suppressionTimer) clearTimeout(suppressionTimer);
  };
}

export function registerEpubContentInteractions(
  source: EpubContentSource,
  options: EpubContentInteractionsOptions,
): () => void {
  const cleanups = new Map<Document, () => void>();
  let pendingInteractiveNavigation: object | null = null;
  const abortPending = () => {
    if (!pendingInteractiveNavigation) return;
    pendingInteractiveNavigation = null;
    options.onInteractiveNavigationAbort?.();
  };
  const interactiveNavigation: InteractiveNavigationLifecycle = {
    abortPending,
    commit(navigation) {
      abortPending();
      const attempt = {};
      pendingInteractiveNavigation = attempt;
      options.onInteractiveNavigationStart?.();
      let result: Promise<boolean>;
      try {
        result = navigation();
      } catch {
        pendingInteractiveNavigation = null;
        options.onInteractiveNavigationAbort?.();
        return;
      }
      void result.then(
        (completed) => {
          if (pendingInteractiveNavigation !== attempt) return;
          pendingInteractiveNavigation = null;
          if (!completed) options.onInteractiveNavigationAbort?.();
        },
        () => {
          if (pendingInteractiveNavigation !== attempt) return;
          pendingInteractiveNavigation = null;
          options.onInteractiveNavigationAbort?.();
        },
      );
    },
  };
  let stopped = false;
  source.hooks.content.register(({ document }) => {
    if (stopped || cleanups.has(document)) return;
    cleanups.set(
      document,
      addDocumentInteractions(document, source, options, interactiveNavigation),
    );
  });
  return () => {
    stopped = true;
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
    abortPending();
  };
}
