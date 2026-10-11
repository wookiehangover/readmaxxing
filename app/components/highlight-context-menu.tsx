import { useEffect, useLayoutEffect, useRef } from "react";
import { Copy, Trash2 } from "lucide-react";
import { menuItemClassName } from "~/components/highlight-popover";
import { cn } from "~/lib/utils";

interface HighlightContextMenuProps {
  position: { x: number; y: number };
  onCopy: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}

export function HighlightContextMenu({
  position,
  onCopy,
  onDelete,
  onDismiss,
}: HighlightContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(pad, Math.min(position.x, window.innerWidth - width - pad))}px`;
    el.style.top = `${Math.max(pad, Math.min(position.y, window.innerHeight - height - pad))}px`;
    itemRef.current?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(current + step + items.length) % items.length]?.focus();
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onDismiss();
    };
    // Clicking into a reader iframe blurs the parent window instead of firing pointerdown here.
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: position.x, top: position.y, zIndex: 9999 }}
      className="min-w-[160px] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        className={menuItemClassName}
        onClick={onCopy}
      >
        <Copy className="size-4" />
        <span>Copy text</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className={cn(
          menuItemClassName,
          "text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive",
        )}
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
        <span>Delete highlight</span>
      </button>
    </div>
  );
}
