import {
  alignPaginationToElement,
  applyPaginatedLayout,
  clearPaginatedLayout,
  effectivePagesPerSpread,
  measurePaginatedLayout,
  restoreElementAnchor,
  snapToSpread,
  type PaginatedLayoutState,
} from "./paginated";
import { applyPreferences, type NavigatorPreferences } from "./preferences";
import { fragmentElement } from "./content-range";

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

function frameViewport(frame: HTMLIFrameElement, container: HTMLElement) {
  const frameRect = frame.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return {
    width: frameRect.width || frame.clientWidth || containerRect.width || container.clientWidth,
    height:
      frameRect.height || frame.clientHeight || containerRect.height || container.clientHeight,
  };
}

function fitPaginatedFrame(frame: HTMLIFrameElement, container: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  if (
    (containerRect.width || container.clientWidth) <= 0 ||
    (containerRect.height || container.clientHeight) <= 0
  )
    return undefined;
  frame.style.width = "100%";
  const viewport = frameViewport(frame, container);
  if (viewport.width <= 0 || viewport.height <= 0) return undefined;
  frame.style.width = `${Math.floor(viewport.width)}px`;
  const fitted = frameViewport(frame, container);
  return fitted.width > 0 && fitted.height > 0 ? fitted : undefined;
}

export async function settleSection(
  options: SettleSectionOptions,
): Promise<PaginatedLayoutState | undefined> {
  const document = options.frame.contentDocument;
  const view = options.frame.contentWindow;
  if (!document || !view) throw new Error("Publication section document is inaccessible");
  // Keep host-owned layout callbacks outside the publication sandbox. Current
  // Safari may refuse to execute rAF callbacks in that window.
  const scheduler = options.container.ownerDocument.defaultView ?? view;
  applyPreferences(document, options.preferences);
  const target =
    options.anchor ??
    (options.fragment ? (fragmentElement(document, options.fragment) ?? undefined) : undefined);
  if (options.preferences.flow !== "paginated") {
    options.frame.style.width = "100%";
    clearPaginatedLayout(document);
    restoreElementAnchor(target);
    const fonts = document.fonts?.ready;
    if (fonts)
      await boundedSettle(waitWithAbort(fonts, options.signal), options.signal, options.timeoutMs);
    await boundedSettle(
      decodeVisibleImages(document, options.signal),
      options.signal,
      options.timeoutMs,
    );
    await nextAnimationFrame(scheduler, options.signal);
    await nextAnimationFrame(scheduler, options.signal);
    if (options.anchor) {
      restoreElementAnchor(options.anchor);
      await nextAnimationFrame(scheduler, options.signal);
    }
    return undefined;
  }

  while (true) {
    const viewport = fitPaginatedFrame(options.frame, options.container);
    if (!viewport) return undefined;
    const pagesPerSpread = effectivePagesPerSpread(
      viewport.width,
      options.preferences.spread,
      options.preferences.minSpreadWidth,
    );
    const geometry = applyPaginatedLayout(
      document,
      viewport,
      pagesPerSpread,
      options.direction,
      undefined,
      options.preferences.pageInlineMargin,
    );
    restoreElementAnchor(target);
    const fonts = document.fonts?.ready;
    if (fonts)
      await boundedSettle(waitWithAbort(fonts, options.signal), options.signal, options.timeoutMs);
    await boundedSettle(
      decodeVisibleImages(document, options.signal),
      options.signal,
      options.timeoutMs,
    );
    await nextAnimationFrame(scheduler, options.signal);
    await nextAnimationFrame(scheduler, options.signal);
    if (options.anchor) {
      restoreElementAnchor(options.anchor);
      await nextAnimationFrame(scheduler, options.signal);
    }
    const pagination = measurePaginatedLayout(document, geometry, options.direction);
    // Fragment/element anchors: column-align to the element. Otherwise snap the
    // current scroll to a spread boundary (live paging / resize).
    if (options.anchor) alignPaginationToElement(pagination, options.anchor);
    else snapToSpread(pagination);
    await nextAnimationFrame(scheduler, options.signal);
    const liveViewport = fitPaginatedFrame(options.frame, options.container);
    if (!liveViewport) return pagination;
    const livePagesPerSpread = effectivePagesPerSpread(
      liveViewport.width,
      options.preferences.spread,
      options.preferences.minSpreadWidth,
    );
    if (
      Math.floor(liveViewport.width) === geometry.viewportWidth &&
      livePagesPerSpread === pagesPerSpread
    )
      return pagination;
  }
}
