import { useState, useRef, useEffect } from "react";
import { Button } from "~/components/ui/button";

interface HighlightPopoverBaseProps {
  position: { x: number; y: number };
  selectedText: string;
  onDismiss: () => void;
}

interface HighlightPopoverCreateProps extends HighlightPopoverBaseProps {
  mode?: "create";
  onSave: (note: string) => void;
  onUpdate?: never;
  onDelete?: never;
  initialNote?: never;
}

interface HighlightPopoverEditProps extends HighlightPopoverBaseProps {
  mode: "edit";
  onUpdate: (note: string) => void;
  onDelete: () => void;
  initialNote: string;
  onSave?: never;
}

type HighlightPopoverProps = HighlightPopoverCreateProps | HighlightPopoverEditProps;

export function HighlightPopover(props: HighlightPopoverProps) {
  const { position, selectedText, onDismiss } = props;
  const isEdit = props.mode === "edit";
  const [note, setNote] = useState(isEdit ? props.initialNote : "");
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSave = () => {
    if (isEdit) {
      props.onUpdate(note);
    } else {
      props.onSave(note);
    }
    setNote("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const truncatedText =
    selectedText.length > 120
      ? selectedText.slice(0, 120) + "…"
      : selectedText;

  return (
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y + 8,
        zIndex: 9999,
      }}
      className="w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <p className="mb-2 text-xs text-muted-foreground line-clamp-3">
        "{truncatedText}"
      </p>
      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isEdit ? "Edit note" : "Add a note (optional)"}
        rows={2}
        className="mb-2 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex justify-end gap-2">
        {isEdit && (
          <Button
            variant="destructive"
            size="sm"
            onClick={props.onDelete}
          >
            Delete
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave}>
          {isEdit ? "Update" : "Save"}
        </Button>
      </div>
    </div>
  );
}

