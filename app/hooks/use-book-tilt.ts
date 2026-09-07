import { useRef, type PointerEvent } from "react";

const MOTION_QUERY =
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

export function useBookTilt(selected: boolean) {
  const bounds = useRef<DOMRect | null>(null);

  function resetTilt(element: HTMLElement) {
    bounds.current = null;
    element.style.removeProperty("--book-tilt");
    element.style.removeProperty("--book-glare-opacity");
  }

  function onPointerMove(event: PointerEvent<HTMLSpanElement>) {
    const volume = event.currentTarget;
    if (!selected || event.pointerType !== "mouse" || !window.matchMedia(MOTION_QUERY).matches) {
      resetTilt(volume);
      return;
    }

    // Keep the starting bounds stable so the moving cover cannot feed back into its own tilt.
    bounds.current ??= volume.querySelector(".bookshelf-cover")!.getBoundingClientRect();
    const rect = bounds.current;
    const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
    const angle = Math.hypot(x, y) * 8;
    volume.style.setProperty("--book-tilt", `${-y} ${x} 0 ${angle}deg`);
    volume.style.setProperty("--book-glare-x", `${(x + 1) * 50}%`);
    volume.style.setProperty("--book-glare-y", `${(y + 1) * 50}%`);
    volume.style.setProperty("--book-glare-opacity", "0.2");
  }

  return {
    onPointerMove,
    onPointerLeave: (event: PointerEvent<HTMLSpanElement>) => resetTilt(event.currentTarget),
    onPointerCancel: (event: PointerEvent<HTMLSpanElement>) => resetTilt(event.currentTarget),
    resetTilt,
  };
}
