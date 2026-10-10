import { useLayoutEffect, useRef, type RefObject } from "react";

const STEP_MS = 4;
const FOLLOW_MS = 55;
// The eye runs ahead of the scroll like a camera on a dolly, then springs back.
const LEAD_MS = 300;
const LEAD_STIFFNESS = 0.012 ** 2;
const LEAD_DAMPING = 2 * 0.72 * 0.012;
// At rest a cover keeps clear of the book above; in motion the stack may close up like a pile.
const REST_GAP = 22;
const MOTION_GAP = 4;

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
  const camera = useRef({ position: Number.NaN, lead: 0, leadVelocity: 0, width: 0, height: 0 });

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
      room: number;
      projection: number;
      depthScale: number;
    }[] = [];

    function update(time = performance.now()) {
      frame = 0;
      const state = camera.current;
      const target = shelf!.scrollTop + viewportHeight * 0.15;
      const distanceToTarget = target - state.position;
      const elapsed = Math.max(0, Math.min(time - previousTime, 64));
      previousTime = time;
      if (
        !smoothMotion.matches ||
        !Number.isFinite(distanceToTarget) ||
        Math.abs(distanceToTarget) > viewportHeight ||
        selectedId
      ) {
        Object.assign(state, { position: target, lead: 0, leadVelocity: 0 });
      } else {
        const maxLead = viewportHeight * 0.45;
        // Fixed steps keep the spring identical across refresh rates.
        for (let step = 0; step < elapsed; step += STEP_MS) {
          const dt = Math.min(STEP_MS, elapsed - step);
          const previous = state.position;
          state.position += (target - state.position) * (1 - Math.exp(-dt / FOLLOW_MS));
          const leadTarget = Math.max(
            -maxLead,
            Math.min(maxLead, ((state.position - previous) / dt) * LEAD_MS),
          );
          state.leadVelocity +=
            ((leadTarget - state.lead) * LEAD_STIFFNESS - state.leadVelocity * LEAD_DAMPING) * dt;
          state.lead += state.leadVelocity * dt;
        }
        if (
          Math.abs(target - state.position) < 0.1 &&
          Math.abs(state.lead) < 0.5 &&
          Math.abs(state.leadVelocity) < 0.01
        ) {
          Object.assign(state, { position: target, lead: 0, leadVelocity: 0 });
        }
      }
      const eye = state.position + state.lead;
      const gap =
        REST_GAP -
        (REST_GAP - MOTION_GAP) * Math.min(1, Math.abs(state.lead) / (viewportHeight * 0.2));
      for (const { element, top, inset, room, projection, depthScale } of scenes) {
        const maxOffset = Math.max(0, room - gap) * projection;
        const distance = top + inset - eye;
        const origin =
          distance > 0 ? inset - Math.min(maxOffset, distance * depthScale) : eye - top;
        element.style.setProperty("--shelf-camera-y", `${origin}px`);
      }
      if (state.position !== target || state.lead !== 0) frame = requestAnimationFrame(update);
    }

    function measure() {
      const shelfTop = layoutTop(shelf!) + shelf!.clientTop;
      viewportHeight = shelf!.clientHeight;
      if (camera.current.width !== shelf!.clientWidth || camera.current.height !== viewportHeight) {
        camera.current = {
          position: shelf!.scrollTop + viewportHeight * 0.15,
          lead: 0,
          leadVelocity: 0,
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
            room: inset + rowGap,
            projection: (perspective + depth) / depth,
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
