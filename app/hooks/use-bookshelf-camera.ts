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
    let scenes: { element: HTMLElement; top: number }[] = [];

    function update() {
      frame = 0;
      const camera = shelf!.scrollTop + viewportHeight / 2;
      for (const { element, top } of scenes) {
        element.style.setProperty("--shelf-camera-y", `${camera - top}px`);
      }
    }

    function measure() {
      const shelfTop = layoutTop(shelf!) + shelf!.clientTop;
      viewportHeight = shelf!.clientHeight;
      scenes = Array.from(
        stack!.querySelectorAll<HTMLElement>('.bookshelf-scene[data-active="true"]'),
        (element) => ({ element, top: layoutTop(element) - shelfTop }),
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
