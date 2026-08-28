export const PAGE_SWIPE_MIN_DISTANCE_PX = 50;
export const PAGE_SWIPE_MIN_INTENT_DISTANCE_PX = 8;
export const PAGE_SWIPE_DISTANCE_RATIO = 0.25;
export const PAGE_SWIPE_MIN_VELOCITY_PX_MS = 0.5;
export const PAGE_SWIPE_VELOCITY_WINDOW_MS = 100;
export const PAGE_SWIPE_DOMINANCE_RATIO = 1.5;

export type PageSwipeDirection = "previous" | "next";
export type PageSwipeReleaseIntent = "complete" | "snap-back" | "boundary";
export type PageSwipeCancellationReason = "multi-touch" | "touchcancel" | "selection" | "cleanup";

export interface PageSwipeProgress {
  readonly direction: PageSwipeDirection;
  readonly displacement: number;
  readonly progress: number;
  readonly boundary: boolean;
}

export interface PageSwipeRelease extends PageSwipeProgress {
  readonly velocity: number;
  readonly intent: PageSwipeReleaseIntent;
}

export interface PageSwipeCancellation extends PageSwipeProgress {
  readonly reason: PageSwipeCancellationReason;
}

export interface PageSwipeRecognizerOptions {
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
  readonly onStart?: (swipe: PageSwipeProgress) => void;
  readonly onProgress?: (swipe: PageSwipeProgress) => void;
  readonly onRelease?: (swipe: PageSwipeRelease) => void;
  readonly onCancel?: (swipe: PageSwipeCancellation) => void;
  readonly canNavigate?: (direction: PageSwipeDirection) => boolean;
  readonly getViewportWidth?: () => number;
  readonly minDistance?: number;
  readonly minIntentDistance?: number;
  readonly distanceRatio?: number;
  readonly minVelocity?: number;
  readonly dominanceRatio?: number;
  readonly getSelection?: () => Selection | null;
  readonly shouldStart?: (event: TouchEvent) => boolean;
}

interface GestureSample {
  readonly x: number;
  readonly time: number;
}

interface GestureSession {
  readonly identifier: number;
  readonly x: number;
  readonly y: number;
  direction: PageSwipeDirection | null;
  boundary: boolean;
  latest: GestureSample;
  samples: GestureSample[];
}

function getTargetSelection(target: EventTarget): Selection | null {
  const documentTarget = target as Document;
  if (typeof documentTarget.getSelection === "function") return documentTarget.getSelection();

  const nodeTarget = target as Node;
  return nodeTarget.ownerDocument?.getSelection() ?? null;
}

function getTargetWidth(target: EventTarget): number {
  const documentTarget = target as Document;
  if (documentTarget.documentElement) {
    return (
      documentTarget.documentElement.clientWidth || documentTarget.defaultView?.innerWidth || 0
    );
  }

  const elementTarget = target as Element;
  if (typeof elementTarget.getBoundingClientRect === "function") {
    return elementTarget.getBoundingClientRect().width;
  }

  return 0;
}

function hasSelectedText(selection: Selection | null): boolean {
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

export function addPageSwipeRecognizer(
  target: EventTarget,
  {
    onPrevious,
    onNext,
    onStart,
    onProgress,
    onRelease,
    onCancel,
    canNavigate = () => true,
    getViewportWidth = () => getTargetWidth(target),
    minDistance = PAGE_SWIPE_MIN_DISTANCE_PX,
    minIntentDistance = PAGE_SWIPE_MIN_INTENT_DISTANCE_PX,
    distanceRatio = PAGE_SWIPE_DISTANCE_RATIO,
    minVelocity = PAGE_SWIPE_MIN_VELOCITY_PX_MS,
    dominanceRatio = PAGE_SWIPE_DOMINANCE_RATIO,
    getSelection = () => getTargetSelection(target),
    shouldStart = () => true,
  }: PageSwipeRecognizerOptions,
): () => void {
  let session: GestureSession | null = null;

  const viewportWidth = () => Math.max(0, getViewportWidth());

  const progressFor = (gesture: GestureSession, x = gesture.latest.x): PageSwipeProgress => {
    const displacement = x - gesture.x;
    const width = viewportWidth();
    return {
      direction: gesture.direction as PageSwipeDirection,
      displacement,
      progress: width > 0 ? displacement / width : 0,
      boundary: gesture.boundary,
    };
  };

  const cancel = (reason: PageSwipeCancellationReason) => {
    const gesture = session;
    session = null;
    if (gesture?.direction) onCancel?.({ ...progressFor(gesture), reason });
  };

  const tryLock = (gesture: GestureSession, x: number, y: number): boolean => {
    if (gesture.direction) return true;

    const deltaX = x - gesture.x;
    const deltaY = y - gesture.y;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);
    if (absoluteX < minIntentDistance && absoluteY < minIntentDistance) return false;
    if (absoluteX < absoluteY * dominanceRatio) {
      session = null;
      return false;
    }
    if (hasSelectedText(getSelection())) {
      session = null;
      return false;
    }

    gesture.direction = deltaX < 0 ? "next" : "previous";
    gesture.boundary = !canNavigate(gesture.direction);
    onStart?.(progressFor(gesture, x));
    return true;
  };

  const record = (gesture: GestureSession, x: number, time: number) => {
    gesture.latest = { x, time };
    gesture.samples = gesture.samples.filter(
      (sample) => sample.time >= time - PAGE_SWIPE_VELOCITY_WINDOW_MS,
    );
    gesture.samples.push(gesture.latest);
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      cancel("multi-touch");
      return;
    }
    if (!shouldStart(event)) {
      session = null;
      return;
    }
    const touch = event.touches[0];
    const sample = { x: touch.clientX, time: event.timeStamp };
    session = {
      identifier: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      direction: null,
      boundary: false,
      latest: sample,
      samples: [sample],
    };
  };

  const handleTouchMove = (event: TouchEvent) => {
    const gesture = session;
    if (!gesture) return;
    if (event.touches.length !== 1 || event.touches[0].identifier !== gesture.identifier) {
      cancel("multi-touch");
      return;
    }

    const touch = event.touches[0];
    if (!tryLock(gesture, touch.clientX, touch.clientY)) return;
    record(gesture, touch.clientX, event.timeStamp);
    onProgress?.(progressFor(gesture));
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const gesture = session;
    if (!gesture) return;
    if (event.touches.length !== 0 || event.changedTouches.length !== 1) {
      cancel("multi-touch");
      return;
    }

    const touch = event.changedTouches[0];
    if (touch.identifier !== gesture.identifier) {
      cancel("multi-touch");
      return;
    }
    if (hasSelectedText(getSelection())) {
      cancel("selection");
      return;
    }
    if (!tryLock(gesture, touch.clientX, touch.clientY)) {
      session = null;
      return;
    }

    record(gesture, touch.clientX, event.timeStamp);
    const progress = progressFor(gesture);
    const velocityStart = gesture.samples[0];
    const elapsed = gesture.latest.time - velocityStart.time;
    const velocity = elapsed > 0 ? (gesture.latest.x - velocityStart.x) / elapsed : 0;
    const directionSign = gesture.direction === "next" ? -1 : 1;
    const distanceThreshold = Math.max(minDistance, viewportWidth() * distanceRatio);
    const movingInDirection = progress.displacement * directionSign > 0;
    const completedByDistance = Math.abs(progress.displacement) >= distanceThreshold;
    const completedByVelocity = velocity * directionSign >= minVelocity;
    const intent: PageSwipeReleaseIntent = gesture.boundary
      ? "boundary"
      : movingInDirection && (completedByDistance || completedByVelocity)
        ? "complete"
        : "snap-back";

    session = null;
    onRelease?.({ ...progress, velocity, intent });
    if (intent !== "complete") return;
    if (gesture.direction === "next") onNext?.();
    else onPrevious?.();
  };

  const handleTouchCancel = () => {
    cancel("touchcancel");
  };

  target.addEventListener("touchstart", handleTouchStart as EventListener, { passive: true });
  target.addEventListener("touchmove", handleTouchMove as EventListener, { passive: true });
  target.addEventListener("touchend", handleTouchEnd as EventListener, { passive: true });
  target.addEventListener("touchcancel", handleTouchCancel, { passive: true });

  return () => {
    cancel("cleanup");
    target.removeEventListener("touchstart", handleTouchStart as EventListener);
    target.removeEventListener("touchmove", handleTouchMove as EventListener);
    target.removeEventListener("touchend", handleTouchEnd as EventListener);
    target.removeEventListener("touchcancel", handleTouchCancel);
  };
}
