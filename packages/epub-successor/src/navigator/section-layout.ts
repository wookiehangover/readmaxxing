import {
  applyPaginatedLayout,
  clearPaginatedLayout,
  currentPageIndex,
  measurePaginatedLayout,
  restoreElementAnchor,
  scrollToPage,
  type PaginatedLayoutState,
} from "./paginated";
import { applyPreferences, type NavigatorPreferences } from "./preferences";

interface SettleSectionOptions {
  readonly frame: HTMLIFrameElement;
  readonly container: HTMLElement;
  readonly preferences: NavigatorPreferences;
  readonly direction: "ltr" | "rtl";
  readonly fragment?: string;
  readonly anchor?: Element;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

function abortError(): DOMException {
  return new DOMException("Navigation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function nextAnimationFrame(view: Window, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const frame = view.requestAnimationFrame(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
    const abort = () => {
      view.cancelAnimationFrame(frame);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function boundedSettle(
  work: Promise<unknown>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  if (timeoutMs === 0) {
    await work;
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  throwIfAborted(signal);
}

async function decodeVisibleImages(document: Document, signal: AbortSignal): Promise<void> {
  const root = document.documentElement;
  const images = Array.from(document.querySelectorAll("img")).filter((image) => {
    const rect = image.getBoundingClientRect();
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= root.clientHeight &&
      rect.left <= root.clientWidth
    );
  });
  await Promise.all(
    images.map((image) =>
      typeof image.decode === "function"
        ? waitWithAbort(
            image.decode().catch(() => undefined),
            signal,
          )
        : Promise.resolve(),
    ),
  );
}

function fragmentTarget(document: Document, fragment: string | undefined): Element | undefined {
  if (!fragment) return undefined;
  let decoded = fragment.replace(/^#/, "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Invalid author encoding is treated as a literal fragment.
  }
  return document.getElementById(decoded) ?? document.getElementsByName(decoded)[0];
}

export async function settleSection(
  options: SettleSectionOptions,
): Promise<PaginatedLayoutState | undefined> {
  const document = options.frame.contentDocument;
  const view = options.frame.contentWindow;
  if (!document || !view) throw new Error("Publication section document is inaccessible");
  applyPreferences(document, options.preferences);
  const geometry =
    options.preferences.flow === "paginated"
      ? applyPaginatedLayout(
          document,
          {
            width: options.frame.clientWidth || options.container.clientWidth || 1,
            height: options.frame.clientHeight || options.container.clientHeight || 1,
          },
          options.preferences.spread === "double" ? 2 : 1,
          options.direction,
        )
      : undefined;
  if (!geometry) clearPaginatedLayout(document);
  const target = options.anchor ?? fragmentTarget(document, options.fragment);
  restoreElementAnchor(target);
  const fonts = document.fonts?.ready;
  if (fonts)
    await boundedSettle(waitWithAbort(fonts, options.signal), options.signal, options.timeoutMs);
  await boundedSettle(
    decodeVisibleImages(document, options.signal),
    options.signal,
    options.timeoutMs,
  );
  await nextAnimationFrame(view, options.signal);
  await nextAnimationFrame(view, options.signal);
  if (options.anchor) {
    restoreElementAnchor(options.anchor);
    await nextAnimationFrame(view, options.signal);
  }
  if (!geometry) return undefined;
  const pagination = measurePaginatedLayout(document, geometry, options.direction);
  const current = target ? currentPageIndex(pagination) : 0;
  scrollToPage(
    pagination,
    Math.floor(current / pagination.pagesPerSpread) * pagination.pagesPerSpread,
  );
  await nextAnimationFrame(view, options.signal);
  return pagination;
}
