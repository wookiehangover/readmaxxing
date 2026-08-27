import { addPageSwipeRecognizer } from "~/hooks/page-swipe-recognizer";

interface EpubContentSource {
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
  options: EpubContentInteractionsOptions,
): () => void {
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
    onPrevious: () => runSwipe(options.onPrevious),
    onNext: () => runSwipe(options.onNext),
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
    cleanups.set(document, addDocumentInteractions(document, options));
  });
  return () => {
    stopped = true;
    for (const cleanup of cleanups.values()) cleanup();
    cleanups.clear();
  };
}
