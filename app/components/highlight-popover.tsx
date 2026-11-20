import { useRef, useEffect } from "react";
import { Copy, MessageSquare, NotebookPen, Sparkles } from "lucide-react";

interface HighlightPopoverProps {
  position: { x: number; y: number };
  onCopyAsMarkdown: () => void;
  onAskQuestion?: () => void;
  onExplain?: () => void;
  onSave: () => void;
  onDismiss: () => void;
}

export const menuItemClassName =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none";

export function HighlightPopover({
  position,
  onCopyAsMarkdown,
  onAskQuestion,
  onExplain,
  onSave,
  onDismiss,
}: HighlightPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;

    if (rect.right > window.innerWidth - pad) {
      el.style.left = `${window.innerWidth - rect.width - pad}px`;
    }
    if (rect.left < pad) {
      el.style.left = `${pad}px`;
    }

    if (rect.bottom > window.innerHeight - pad) {
      el.style.top = `${position.y - rect.height - 8}px`;
    }
  }, [position]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onDismiss]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
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
        <Copy className="size-4" />
        <span>Copy text</span>
      </button>
      {onAskQuestion ? (
        <button type="button" className={menuItemClassName} onClick={onAskQuestion}>
          <MessageSquare className="size-4" />
          <span>Ask a question</span>
        </button>
      ) : null}
      {onExplain ? (
        <button type="button" className={menuItemClassName} onClick={onExplain}>
          <Sparkles className="size-4" />
          <span>Explain this</span>
        </button>
      ) : null}
      <button type="button" className={menuItemClassName} onClick={onSave}>
        <NotebookPen className="size-4" />
        <span>Add to Notebook</span>
      </button>
    </div>
  );
}
