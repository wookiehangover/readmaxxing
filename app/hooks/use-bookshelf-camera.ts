import { useLayoutEffect, type RefObject } from "react";

function layoutTop(element: HTMLElement) {
  let top = 0;
  for (
    let current: HTMLElement | null = element;
    current;
    current = current.offsetParent as HTMLElement | null
  ) {
    top += current.offsetTop;
  }
  return top;
}

export function useBookshelfCamera(
  stackRef: RefObject<HTMLOListElement | null>,
  visibleIds: Set<string>,
  selectedId: string | null,
) {
  useLayoutEffect(() => {
    const stack = stackRef.current;
    const shelf = stack?.closest<HTMLElement>(".bookshelf");
    if (!stack || !shelf) return;

    let frame = 0;
    let viewportHeight = 0;
    let scenes: {
      element: HTMLElement;
      top: number;
      inset: number;
      maxOffset: number;
      depthScale: number;
    }[] = [];

    function update() {
      frame = 0;
      const camera = shelf!.scrollTop + viewportHeight * 0.15;
      for (const { element, top, inset, maxOffset, depthScale } of scenes) {
        const distance = top + inset - camera;
        const origin =
          distance > 0 ? inset - Math.min(maxOffset, distance * depthScale) : camera - top;
        element.style.setProperty("--shelf-camera-y", `${origin}px`);
      }
    }

    function measure() {
      const shelfTop = layoutTop(shelf!) + shelf!.clientTop;
      viewportHeight = shelf!.clientHeight;
      scenes = Array.from(
        stack!.querySelectorAll<HTMLElement>('.bookshelf-scene[data-active="true"]'),
        (element) => {
          const style = getComputedStyle(element);
          const inset = parseFloat(style.paddingTop);
          const depth = element.clientWidth * (2 / 3);
          const perspective = parseFloat(style.perspective);
          const rowGap = parseFloat(getComputedStyle(element.closest("li")!).marginBottom);
          return {
            element,
            top: layoutTop(element) - shelfTop,
            inset,
            maxOffset: (Math.max(0, inset + rowGap - 22) * (perspective + depth)) / depth,
            depthScale: (element.clientWidth * 1.38) / viewportHeight,
          };
        },
      );
      cancelAnimationFrame(frame);
      update();
    }

    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shelf);
    observer.observe(stack);
    shelf.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      shelf.removeEventListener("scroll", onScroll);
    };
  }, [stackRef, visibleIds, selectedId]);
}
