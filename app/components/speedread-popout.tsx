import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Pause, Play, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Slider } from "~/components/ui/slider";
import { useSpeedreadPlayback } from "~/hooks/use-speedread-playback";

export interface SpeedreadPopoutProps {
  bookId: string;
  open: boolean;
  words: readonly string[];
  onClose: () => void;
}

interface Position {
  left: number;
  top: number;
}

interface Size {
  width: number;
  height: number;
}

interface StoredLayout extends Position {
  width?: number;
  height?: number;
}

type Layout = Position & Size;

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

const LAYOUT_STORAGE_KEY = "speedread-popout-position";
const DEFAULT_SIZE: Size = { width: 480, height: 320 };
const MIN_SIZE: Size = { width: 320, height: 256 };
const RESIZE_SAVE_DELAY_MS = 150;

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]")
  );
}

function loadLayout(): StoredLayout | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null");
    if (
      typeof value !== "object" ||
      value === null ||
      !("left" in value) ||
      !("top" in value) ||
      typeof value.left !== "number" ||
      typeof value.top !== "number" ||
      !Number.isFinite(value.left) ||
      !Number.isFinite(value.top)
    ) {
      return null;
    }

    const position = { left: value.left, top: value.top };
    if (
      "width" in value &&
      "height" in value &&
      typeof value.width === "number" &&
      typeof value.height === "number" &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height)
    ) {
      return { ...position, width: value.width, height: value.height };
    }
    return position;
  } catch {
    return null;
  }
}

function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Layout persistence is optional when storage is unavailable.
  }
}

function clampSize(size: Size): Size {
  const maxWidth = Math.max(MIN_SIZE.width, window.innerWidth - 32);
  const maxHeight = Math.max(MIN_SIZE.height, window.innerHeight - 80);
  return {
    width: Math.min(Math.max(MIN_SIZE.width, size.width), maxWidth),
    height: Math.min(Math.max(MIN_SIZE.height, size.height), maxHeight),
  };
}

function clampPosition(position: Position, width: number, height: number): Position {
  return {
    left: Math.min(Math.max(0, position.left), Math.max(0, window.innerWidth - width)),
    top: Math.min(Math.max(0, position.top), Math.max(0, window.innerHeight - height)),
  };
}

export function SpeedreadPopout({ bookId, open, words, onClose }: SpeedreadPopoutProps) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionRef = useRef<Position | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const { currentWord, isPlaying, persistProgress, setWpm, togglePlayback, wordIndex, wpm } =
    useSpeedreadPlayback(words, bookId);

  const handleClose = useCallback(() => {
    if (isPlaying) togglePlayback();
    persistProgress();
    onClose();
  }, [isPlaying, onClose, persistProgress, togglePlayback]);

  useEffect(() => {
    if (!open) return;

    const savedLayout = loadLayout();
    const nextSize = clampSize(
      savedLayout?.width !== undefined && savedLayout.height !== undefined
        ? { width: savedLayout.width, height: savedLayout.height }
        : DEFAULT_SIZE,
    );
    const panel = panelRef.current;
    if (panel) {
      panel.style.width = `${nextSize.width}px`;
      panel.style.height = `${nextSize.height}px`;
    }
    setSize(nextSize);

    if (!savedLayout) {
      positionRef.current = null;
      setPosition(null);
      return;
    }

    const nextPosition = clampPosition(savedLayout, nextSize.width, nextSize.height);
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    saveLayout({ ...nextPosition, ...nextSize });
  }, [open]);

  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;

    const panel = panelRef.current;
    if (!panel) return;

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingLayout: Layout | null = null;
    const observer = new ResizeObserver(() => {
      const rect = panel.getBoundingClientRect();
      const nextSize = clampSize({ width: rect.width, height: rect.height });
      const nextPosition = clampPosition(
        positionRef.current ?? { left: rect.left, top: rect.top },
        nextSize.width,
        nextSize.height,
      );

      positionRef.current = nextPosition;
      setPosition((current) =>
        current?.left === nextPosition.left && current.top === nextPosition.top
          ? current
          : nextPosition,
      );
      setSize((current) =>
        current?.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize,
      );

      pendingLayout = { ...nextPosition, ...nextSize };
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (pendingLayout) saveLayout(pendingLayout);
        pendingLayout = null;
      }, RESIZE_SAVE_DELAY_MS);
    });

    observer.observe(panel);
    return () => {
      observer.disconnect();
      clearTimeout(saveTimer);
      if (pendingLayout) saveLayout(pendingLayout);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }

      if (
        event.code !== "Space" ||
        isEditableTarget(event.target) ||
        isEditableTarget(document.activeElement)
      ) {
        return;
      }

      event.preventDefault();
      togglePlayback();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, open, togglePlayback]);

  if (!open || typeof document === "undefined") return null;

  const hasWords = words.length > 0;
  const displayedIndex = hasWords ? Math.min(wordIndex + 1, words.length) : 0;
  const progress = hasWords ? (displayedIndex / words.length) * 100 : 0;

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    const nextPosition = { left: rect.left, top: rect.top };
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;

    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const nextPosition = {
      left: Math.min(Math.max(0, event.clientX - drag.offsetX), maxLeft),
      top: Math.min(Math.max(0, event.clientY - drag.offsetY), maxTop),
    };
    positionRef.current = nextPosition;
    setPosition(nextPosition);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const panel = panelRef.current;
    if (positionRef.current && panel) {
      const rect = panel.getBoundingClientRect();
      saveLayout({ ...positionRef.current, width: rect.width, height: rect.height });
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return createPortal(
    <section
      ref={panelRef}
      role="dialog"
      aria-labelledby="speedread-title"
      aria-modal="false"
      className="fixed z-[9999] flex h-80 max-h-[calc(100vh-5rem)] min-h-64 w-[min(30rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] min-w-80 resize flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl"
      style={{ ...(position ?? { top: "4rem", right: "1rem" }), ...size }}
    >
      <header
        className="flex shrink-0 touch-none cursor-move items-center justify-between border-b px-3 py-2 select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      >
        <h2 id="speedread-title" className="text-sm font-medium">
          Speedread
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={handleClose} aria-label="Close Speedread">
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-4">
        <p
          aria-live="off"
          className="max-w-full truncate text-center text-[clamp(2rem,8vw,4.5rem)] leading-none font-semibold"
        >
          {currentWord || "No words on this page"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t p-4">
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {displayedIndex} / {words.length}
          </span>
          <span className="tabular-nums">{wpm} WPM</span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            disabled={!hasWords || (!isPlaying && wordIndex >= words.length - 1)}
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause Speedread" : "Play Speedread"}
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>
          <Slider
            value={[wpm]}
            min={100}
            max={900}
            step={25}
            disabled={!hasWords}
            aria-label="Words per minute"
            onValueChange={(value) => setWpm(Array.isArray(value) ? value[0] : value)}
          />
        </div>
      </div>
    </section>,
    document.body,
  );
}
