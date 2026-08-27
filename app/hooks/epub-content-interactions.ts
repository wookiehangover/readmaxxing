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
  readonly isPaginatedMobile: () => boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToggleToolbar: () => void;
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

function addDocumentInteractions(
  document: Document,
  source: EpubContentSource,
  options: EpubContentInteractionsOptions,
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
    if (!options.isPaginatedMobile()) return;
    suppressSyntheticClick();
    callback();
  };
  const removeSwipeRecognizer = addPageSwipeRecognizer(document, {
    getSelection: () => document.getSelection(),
    onStart: ({ direction }) => {
      if (!options.isPaginatedMobile()) return;
      suppressSyntheticClick();
      interactiveTurn = source.navigator?.beginInteractivePageTurn(direction) ?? false;
    },
    onProgress: ({ displacement }) => {
      if (interactiveTurn) source.navigator?.updateInteractivePageTurn(displacement);
    },
    onRelease: ({ direction, displacement, intent }) => {
      if (interactiveTurn) {
        interactiveTurn = false;
        source.navigator?.updateInteractivePageTurn(displacement);
        void source.navigator?.endInteractivePageTurn(intent === "complete").catch(() => {});
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
    if (!options.isPaginatedMobile()) return;
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (event.button !== 0 || hasSelectedText(document) || isInteractiveTarget(event.target))
      return;
    const width = document.documentElement.clientWidth || document.defaultView?.innerWidth || 0;
    if (!width) return;
    if (event.clientX < width / 4) options.onPrevious();
    else if (event.clientX > (width * 3) / 4) options.onNext();
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
  let stopped = false;
  source.hooks.content.register(({ document }) => {
    if (stopped || cleanups.has(document)) return;
    cleanups.set(document, addDocumentInteractions(document, source, options));
  });
  return () => {
    stopped = true;
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
  };
}
