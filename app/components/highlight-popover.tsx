import { useRef, useEffect } from "react";
import { ClipboardCopy, NotebookPen } from "lucide-react";

const menuItemClassName =
  "relative flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

interface HighlightPopoverProps {
  position: { x: number; y: number };
  onCopyAsMarkdown: () => void;
  onSave: () => void;
  onDismiss: () => void;
}

export function HighlightPopover({
  position,
  onCopyAsMarkdown,
  onSave,
  onDismiss,
}: HighlightPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Position the popover so it doesn't overflow the viewport
  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;

    // Adjust horizontal position if overflowing
    if (rect.right > window.innerWidth - pad) {
      el.style.left = `${window.innerWidth - rect.width - pad}px`;
    }
    if (rect.left < pad) {
      el.style.left = `${pad}px`;
    }

    // Adjust vertical position if overflowing bottom
    if (rect.bottom > window.innerHeight - pad) {
      el.style.top = `${position.y - rect.height - 8}px`;
    }
  }, [position]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onDismiss]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    // Delay to avoid triggering on the selection click itself
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onDismiss]);

  return (
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y + 8,
        zIndex: 9999,
      }}
      className="w-auto min-w-[160px] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <button type="button" className={menuItemClassName} onClick={onCopyAsMarkdown}>
        <ClipboardCopy />
        <span>Copy as Markdown</span>
      </button>
      <button type="button" className={menuItemClassName} onClick={onSave}>
        <NotebookPen />
        <span>Add to Notebook</span>
      </button>
    </div>
  );
}
