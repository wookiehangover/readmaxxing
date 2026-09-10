import { useLayoutEffect, useRef, type RefObject } from "react";

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
  const camera = useRef({ position: Number.NaN, width: 0, height: 0 });

  useLayoutEffect(() => {
    const stack = stackRef.current;
    const shelf = stack?.closest<HTMLElement>(".bookshelf");
    if (!stack || !shelf) return;

    let frame = 0;
    let previousTime = 0;
    let viewportHeight = 0;
    const smoothMotion = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    let scenes: {
      element: HTMLElement;
      top: number;
      inset: number;
      maxOffset: number;
      depthScale: number;
    }[] = [];

    function update(time = performance.now()) {
      frame = 0;
      const target = shelf!.scrollTop + viewportHeight * 0.15;
      const distanceToTarget = target - camera.current.position;
      const elapsed = Math.max(0, Math.min(time - previousTime, 64));
      previousTime = time;
      if (
        !smoothMotion.matches ||
        !Number.isFinite(distanceToTarget) ||
        Math.abs(distanceToTarget) < 0.1 ||
        Math.abs(distanceToTarget) > viewportHeight ||
        selectedId
      ) {
        camera.current.position = target;
      } else {
        camera.current.position += distanceToTarget * (1 - Math.exp(-elapsed / 55));
      }
      for (const { element, top, inset, maxOffset, depthScale } of scenes) {
        const distance = top + inset - camera.current.position;
        const origin =
          distance > 0
            ? inset - Math.min(maxOffset, distance * depthScale)
            : camera.current.position - top;
        element.style.setProperty("--shelf-camera-y", `${origin}px`);
      }
      if (camera.current.position !== target) frame = requestAnimationFrame(update);
    }

    function measure() {
      const shelfTop = layoutTop(shelf!) + shelf!.clientTop;
      viewportHeight = shelf!.clientHeight;
      if (camera.current.width !== shelf!.clientWidth || camera.current.height !== viewportHeight) {
        camera.current = {
          position: shelf!.scrollTop + viewportHeight * 0.15,
          width: shelf!.clientWidth,
          height: viewportHeight,
        };
      }
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
      previousTime = performance.now();
      update();
    }

    function onScroll() {
      if (!frame) {
        previousTime = performance.now();
        frame = requestAnimationFrame(update);
      }
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shelf);
    observer.observe(stack);
    shelf.addEventListener("scroll", onScroll, { passive: true });
    smoothMotion.addEventListener("change", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      shelf.removeEventListener("scroll", onScroll);
      smoothMotion.removeEventListener("change", measure);
    };
  }, [stackRef, visibleIds, selectedId]);
}
