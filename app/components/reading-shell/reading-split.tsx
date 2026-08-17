import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  DEFAULT_RAIL_WIDTH,
  RAIL_WIDTH_STORAGE_KEY,
} from "~/components/reading-shell/reading-rail-width";
import { cn } from "~/lib/utils";

const MIN_BOOK_WIDTH = 640;
const MIN_RAIL_WIDTH = 320;
const KEYBOARD_RESIZE_STEP = 16;

type DragState = {
  pointerId: number;
  startX: number;
  startWidth: number;
};

function persistRailWidth(width: number) {
  try {
    window.sessionStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function ReadingSplit({ book, rail }: { book: ReactNode; rail: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL_WIDTH);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const maximumRailWidth = useCallback(() => {
    const fallbackWidth =
      typeof window === "undefined" ? DEFAULT_RAIL_WIDTH + MIN_BOOK_WIDTH : window.innerWidth;
    const shellWidth = shellRef.current?.getBoundingClientRect().width || fallbackWidth;
    return Math.max(MIN_RAIL_WIDTH, shellWidth - MIN_BOOK_WIDTH);
  }, []);

  const clampRailWidth = useCallback(
    (width: number) => Math.min(Math.max(width, MIN_RAIL_WIDTH), maximumRailWidth()),
    [maximumRailWidth],
  );

  const updateRailWidth = useCallback(
    (width: number) => {
      const nextWidth = clampRailWidth(width);
      setRailWidth(nextWidth);
      persistRailWidth(nextWidth);
    },
    [clampRailWidth],
  );

  useEffect(() => {
    try {
      const storedWidth = Number(window.sessionStorage.getItem(RAIL_WIDTH_STORAGE_KEY));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setRailWidth(clampRailWidth(storedWidth));
      }
    } catch {
      // Keep the default width when storage is unavailable.
    }

    const handleResize = () => {
      setRailWidth((currentWidth) => {
        const nextWidth = clampRailWidth(currentWidth);
        if (nextWidth !== currentWidth) persistRailWidth(nextWidth);
        return nextWidth;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampRailWidth]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: railWidth,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateRailWidth(drag.startWidth + drag.startX - event.clientX);
  };

  const finishDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = railWidth + KEYBOARD_RESIZE_STEP;
    if (event.key === "ArrowRight") nextWidth = railWidth - KEYBOARD_RESIZE_STEP;
    if (event.key === "Home") nextWidth = MIN_RAIL_WIDTH;
    if (event.key === "End") nextWidth = maximumRailWidth();
    if (nextWidth === null) return;
    event.preventDefault();
    updateRailWidth(nextWidth);
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = null;
    setIsDragging(false);
    updateRailWidth(DEFAULT_RAIL_WIDTH);
  };

  const isDividerVisible = isHovered || isFocused || isDragging;

  return (
    <div ref={shellRef} className="flex h-full min-h-0 bg-background" data-testid="reading-shell">
      <main
        className="min-w-0 flex-1 outline-none md:min-w-[40rem]"
        aria-label="Book surface"
        tabIndex={-1}
      >
        {book}
      </main>
      <aside
        className="relative hidden min-w-[20rem] shrink-0 bg-background md:block"
        style={{ width: railWidth }}
        aria-label="Reading rail"
      >
        <div
          role="separator"
          aria-label="Resize reading rail"
          aria-orientation="vertical"
          aria-valuemin={MIN_RAIL_WIDTH}
          aria-valuemax={maximumRailWidth()}
          aria-valuenow={railWidth}
          className="absolute inset-y-0 -left-1.5 flex w-3 touch-none cursor-col-resize justify-center outline-none"
          tabIndex={0}
          onPointerEnter={() => setIsHovered(true)}
          onPointerLeave={() => setIsHovered(false)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDragging}
          onPointerCancel={finishDragging}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
        >
          <span
            className={cn("h-full w-px bg-transparent transition-colors", {
              "bg-border": isDividerVisible,
            })}
            data-testid="reading-divider-line"
            data-visible={isDividerVisible}
          />
        </div>
        {rail}
      </aside>
    </div>
  );
}
