import {
  addPageSwipeRecognizer,
  type PageSwipeDirection,
  type PageSwipeProgress,
  type PageSwipeReleaseIntent,
} from "~/hooks/page-swipe-recognizer";

const PDF_CAROUSEL_SETTLE_MS = 180;
const PDF_CAROUSEL_EDGE_RESISTANCE = 0.3;
const PDF_CAROUSEL_MAX_EDGE_PROGRESS = 0.12;
const PDF_RENDERING_FINISHED = 3;
const INTERACTIVE_SELECTOR = "a, button, input, textarea, select, summary, [contenteditable]";

interface PdfPageCarouselOptions {
  container: HTMLElement;
  getViewer: () => any;
  getCurrentPage: () => number;
  getTotalPages: () => number;
  preparePage: (page: number) => Promise<boolean>;
  onNavigate: (page: number) => void;
  onGestureStart?: () => void;
  getSelection?: () => Selection | null;
}

interface CarouselLayer {
  direction: PageSwipeDirection;
  currentPage: number;
  neighborPage: number;
  width: number;
  layer: HTMLDivElement;
  currentFrame: HTMLDivElement;
  neighborFrame: HTMLDivElement;
  viewerElement: HTMLElement | null;
}

function cloneRenderedPage(viewer: any, pageNumber: number): HTMLElement | null {
  const pageView = viewer?.getPageView?.(pageNumber - 1);
  const source = pageView?.div as HTMLElement | undefined;
  if (
    !source ||
    source.dataset.pageNumber !== String(pageNumber) ||
    pageView.renderingState !== PDF_RENDERING_FINISHED
  ) {
    return null;
  }

  const clone = source.cloneNode(true) as HTMLElement;
  const sourceCanvases = source.querySelectorAll("canvas");
  const cloneCanvases = clone.querySelectorAll("canvas");
  sourceCanvases.forEach((sourceCanvas, index) => {
    const cloneCanvas = cloneCanvases[index];
    if (!cloneCanvas) return;
    cloneCanvas.width = sourceCanvas.width;
    cloneCanvas.height = sourceCanvas.height;
    try {
      cloneCanvas.getContext("2d")?.drawImage(sourceCanvas, 0, 0);
    } catch {
      // A page may use a protected or detached canvas; never substitute another page.
    }
  });
  clone.style.margin = "0";
  return clone;
}

function createFrame(pageNumber: number): HTMLDivElement {
  const frame = document.createElement("div");
  frame.dataset.pdfCarouselPage = String(pageNumber);
  Object.assign(frame.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    willChange: "transform",
  });
  return frame;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function addPdfPageCarousel({
  container,
  getViewer,
  getCurrentPage,
  getTotalPages,
  preparePage,
  onNavigate,
  onGestureStart,
  getSelection = () => window.getSelection(),
}: PdfPageCarouselOptions): () => void {
  let carousel: CarouselLayer | null = null;
  let settleTimer: number | null = null;
  let sessionId = 0;

  const clearSettleTimer = () => {
    if (settleTimer === null) return;
    window.clearTimeout(settleTimer);
    settleTimer = null;
  };

  const cleanupLayer = () => {
    clearSettleTimer();
    const active = carousel;
    carousel = null;
    active?.layer.remove();
    if (active?.viewerElement) active.viewerElement.style.visibility = "";
  };

  const addPageToFrame = (frame: HTMLElement, pageNumber: number): boolean => {
    if (pageNumber < 1 || pageNumber > getTotalPages()) return false;
    if (frame.firstElementChild) return true;
    const page = cloneRenderedPage(getViewer(), pageNumber);
    if (!page) return false;
    frame.append(page);
    return true;
  };

  const applyDisplacement = (swipe: PageSwipeProgress, animate = false) => {
    const active = carousel;
    if (!active) return;
    const displacement = swipe.boundary
      ? Math.sign(swipe.displacement) *
        Math.min(
          Math.abs(swipe.displacement) * PDF_CAROUSEL_EDGE_RESISTANCE,
          active.width * PDF_CAROUSEL_MAX_EDGE_PROGRESS,
        )
      : swipe.displacement;
    const transition = animate
      ? `transform ${PDF_CAROUSEL_SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
      : "none";
    for (const frame of [active.currentFrame, active.neighborFrame]) {
      frame.style.transition = transition;
      const offset = frame === active.neighborFrame ? (active.direction === "next" ? 1 : -1) : 0;
      frame.style.transform = `translate3d(${displacement + offset * active.width}px, 0, 0)`;
    }
    if (!swipe.boundary) addPageToFrame(active.neighborFrame, active.neighborPage);
  };

  const begin = (swipe: PageSwipeProgress) => {
    cleanupLayer();
    sessionId += 1;
    onGestureStart?.();

    const viewer = getViewer();
    const currentPage = getCurrentPage();
    const neighborPage = currentPage + (swipe.direction === "next" ? 1 : -1);
    const current = cloneRenderedPage(viewer, currentPage);
    if (!current) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width || container.clientWidth;
    if (width <= 0) return;

    const layer = document.createElement("div");
    layer.dataset.pdfPageCarousel = "true";
    Object.assign(layer.style, {
      position: "absolute",
      top: `${container.scrollTop}px`,
      left: `${container.scrollLeft}px`,
      width: `${width}px`,
      height: `${rect.height || container.clientHeight}px`,
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "4",
    });
    const currentFrame = createFrame(currentPage);
    const neighborFrame = createFrame(neighborPage);
    currentFrame.append(current);
    layer.append(currentFrame, neighborFrame);
    container.append(layer);

    const viewerElement = container.querySelector<HTMLElement>(".pdfViewer");
    if (viewerElement) viewerElement.style.visibility = "hidden";
    carousel = {
      direction: swipe.direction,
      currentPage,
      neighborPage,
      width,
      layer,
      currentFrame,
      neighborFrame,
      viewerElement,
    };
    if (!swipe.boundary) addPageToFrame(neighborFrame, neighborPage);
    applyDisplacement(swipe);

    if (swipe.boundary) return;
    const startedSession = sessionId;
    void preparePage(neighborPage).then((available) => {
      if (!available || startedSession !== sessionId || carousel?.neighborPage !== neighborPage) {
        return;
      }
      addPageToFrame(neighborFrame, neighborPage);
    });
  };

  const settle = (intent: PageSwipeReleaseIntent, direction: PageSwipeDirection) => {
    const active = carousel;
    if (!active) return;
    const complete = intent === "complete";
    const target = complete ? (direction === "next" ? -active.width : active.width) : 0;
    const reducedMotion = prefersReducedMotion();
    applyDisplacement(
      { direction, displacement: target, progress: target / active.width, boundary: false },
      !reducedMotion,
    );
    if (reducedMotion) {
      cleanupLayer();
      return;
    }
    settleTimer = window.setTimeout(cleanupLayer, PDF_CAROUSEL_SETTLE_MS);
  };

  const removeRecognizer = addPageSwipeRecognizer(container, {
    canNavigate: (direction) => {
      const currentPage = getCurrentPage();
      return direction === "next" ? currentPage < getTotalPages() : currentPage > 1;
    },
    getViewportWidth: () => container.getBoundingClientRect().width || container.clientWidth,
    getSelection,
    shouldStart: (event) =>
      !(event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)),
    onStart: begin,
    onProgress: (swipe) => applyDisplacement(swipe),
    onRelease: (swipe) => settle(swipe.intent, swipe.direction),
    onCancel: (swipe) => settle("snap-back", swipe.direction),
    onPrevious: () => onNavigate(Math.max(1, getCurrentPage() - 1)),
    onNext: () => onNavigate(Math.min(getTotalPages(), getCurrentPage() + 1)),
  });

  return () => {
    sessionId += 1;
    removeRecognizer();
    cleanupLayer();
  };
}
