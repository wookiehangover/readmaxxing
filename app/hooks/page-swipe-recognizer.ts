export const PAGE_SWIPE_MIN_DISTANCE_PX = 50;
export const PAGE_SWIPE_MAX_DURATION_MS = 600;
export const PAGE_SWIPE_DOMINANCE_RATIO = 1.5;

export interface PageSwipeRecognizerOptions {
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly minDistance?: number;
  readonly maxDuration?: number;
  readonly dominanceRatio?: number;
  readonly getSelection?: () => Selection | null;
}

interface GestureStart {
  readonly identifier: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

function getTargetSelection(target: EventTarget): Selection | null {
  const documentTarget = target as Document;
  if (typeof documentTarget.getSelection === "function") return documentTarget.getSelection();

  const nodeTarget = target as Node;
  return nodeTarget.ownerDocument?.getSelection() ?? null;
}

function hasSelectedText(selection: Selection | null): boolean {
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

export function addPageSwipeRecognizer(
  target: EventTarget,
  {
    onPrevious,
    onNext,
    minDistance = PAGE_SWIPE_MIN_DISTANCE_PX,
    maxDuration = PAGE_SWIPE_MAX_DURATION_MS,
    dominanceRatio = PAGE_SWIPE_DOMINANCE_RATIO,
    getSelection = () => getTargetSelection(target),
  }: PageSwipeRecognizerOptions,
): () => void {
  let start: GestureStart | null = null;

  const reset = () => {
    start = null;
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0];
    start = {
      identifier: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      time: event.timeStamp,
    };
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length !== 1 || event.touches[0].identifier !== start.identifier) reset();
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const gesture = start;
    reset();
    if (!gesture || event.touches.length !== 0 || event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    if (touch.identifier !== gesture.identifier || hasSelectedText(getSelection())) return;

    const deltaX = touch.clientX - gesture.x;
    const deltaY = touch.clientY - gesture.y;
    const duration = event.timeStamp - gesture.time;
    if (
      duration < 0 ||
      duration > maxDuration ||
      Math.abs(deltaX) < minDistance ||
      Math.abs(deltaX) < Math.abs(deltaY) * dominanceRatio
    ) {
      return;
    }

    if (deltaX < 0) onNext();
    else onPrevious();
  };

  target.addEventListener("touchstart", handleTouchStart as EventListener, { passive: true });
  target.addEventListener("touchmove", handleTouchMove as EventListener, { passive: true });
  target.addEventListener("touchend", handleTouchEnd as EventListener, { passive: true });
  target.addEventListener("touchcancel", reset, { passive: true });

  return () => {
    reset();
    target.removeEventListener("touchstart", handleTouchStart as EventListener);
    target.removeEventListener("touchmove", handleTouchMove as EventListener);
    target.removeEventListener("touchend", handleTouchEnd as EventListener);
    target.removeEventListener("touchcancel", reset);
  };
}
