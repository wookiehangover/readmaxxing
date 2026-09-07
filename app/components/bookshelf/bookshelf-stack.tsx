import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BookshelfBook } from "~/components/bookshelf/bookshelf-book";
import { useBookshelfVisibility } from "~/hooks/use-bookshelf-visibility";
import type { BookMeta } from "~/lib/stores/book-store";
import "~/components/bookshelf/bookshelf.css";
import "~/components/bookshelf/bookshelf-selection.css";

interface BookshelfStackProps {
  books: BookMeta[];
  onOpenBook?: (book: BookMeta) => void | Promise<void>;
}

export function BookshelfStack({ books, onOpenBook }: BookshelfStackProps) {
  const [selection, setSelection] = useState<{
    id: string;
    layout: string;
    open: boolean;
    style: CSSProperties;
    recedingIds: string[];
  } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const layout = books.map((book) => book.id).join("\0");
  const { stackRef, visibleIds, entranceIds } = useBookshelfVisibility(layout);
  const selectedId = selection?.open && selection.layout === layout ? selection.id : null;

  function close() {
    setSelection((current) => current && { ...current, open: false });
  }

  useEffect(() => {
    if (!selectedId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
        // Pointer dismissal must not manufacture a keyboard focus ring in Safari.
        trigger.current?.focus({ preventScroll: true });
      }
    }
    // The placement is measured in viewport coordinates; return before that viewport changes.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    const shelf = window.matchMedia("(min-width: 768px)").matches
      ? trigger.current?.closest(".bookshelf")
      : null;
    const scrollTop = shelf?.scrollTop;
    const scrollLeft = shelf?.scrollLeft;
    function onScroll() {
      // A scroll into view before selection can deliver its event after this listener mounts.
      if (shelf?.scrollTop !== scrollTop || shelf?.scrollLeft !== scrollLeft) close();
    }
    shelf?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      shelf?.removeEventListener("scroll", onScroll);
    };
  }, [selectedId]);

  useEffect(() => {
    if (selection?.open && !selectedId) {
      setSelection((current) => current && { ...current, open: false });
    }
  }, [selectedId, selection?.open]);

  function select(book: BookMeta, button: HTMLButtonElement) {
    if (selectedId) {
      close();
      return;
    }
    button.getAnimations().forEach((animation) => animation.finish());
    const rect = button.getBoundingClientRect();
    const volume = button.querySelector<HTMLElement>(".bookshelf-volume")!;
    const shelf = button.closest(".bookshelf")!.getBoundingClientRect();
    const width = volume.offsetWidth;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const scale = mobile ? 0.85 : Math.min(480, shelf.height * 0.58, shelf.width * 0.48) / width;
    const centerX = mobile ? rect.left + width / 2 : shelf.left + shelf.width * 0.27;
    const centerY = mobile
      ? rect.top + volume.offsetTop + (width * scale) / 2
      : shelf.top + shelf.height * 0.48;
    const x = centerX - rect.left - width / 2 - (width / 3) * scale * Math.cos(Math.PI / 30);
    const y = centerY - rect.top - volume.offsetTop;
    // Promoting every row to a new 3D layer stalls WebKit on large libraries.
    // Include a gutter for nearby books; desktop scrolling dismisses selection.
    const recedingIds = mobile
      ? []
      : books
          .filter((_, index) => {
            const row = button.closest("ol")!.children[index].getBoundingClientRect();
            return row.bottom > shelf.top - 200 && row.top < shelf.bottom + 200;
          })
          .map((candidate) => candidate.id);
    trigger.current = button;
    setSelection({
      id: book.id,
      layout,
      open: true,
      recedingIds,
      style: {
        "--selected-x": `${x}px`,
        "--selected-y": `${y}px`,
        "--selected-scale": scale,
        "--selected-space": `${Math.max(0, width * scale - volume.offsetHeight + 76)}px`,
        "--read-x": `${centerX - rect.left}px`,
        "--read-y": `${centerY - rect.top + (width * scale) / 2 + 28}px`,
      } as CSSProperties,
    });
  }

  return (
    <ol
      ref={stackRef}
      className="bookshelf-stack"
      aria-label="Your books"
      data-selection={Boolean(selectedId)}
      onClick={(event) => {
        if (selectedId && !(event.target as Element).closest("a")) close();
      }}
    >
      {books.map((book, index) => (
        <li
          key={book.id}
          data-book-id={book.id}
          data-active={visibleIds.has(book.id) || selectedId === book.id}
          data-entrance={entranceIds.has(book.id)}
          data-selected={selectedId === book.id}
          data-receding={Boolean(selectedId && selection?.recedingIds.includes(book.id))}
          style={selection?.id === book.id ? selection.style : undefined}
        >
          <BookshelfBook
            book={book}
            index={index}
            selected={selectedId === book.id}
            active={visibleIds.has(book.id) || selectedId === book.id}
            onSelect={(button) => select(book, button)}
            onOpenBook={onOpenBook}
          />
        </li>
      ))}
    </ol>
  );
}
