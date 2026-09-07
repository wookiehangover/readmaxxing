import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BookshelfBook } from "~/components/bookshelf/bookshelf-book";
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
  } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const layout = books.map((book) => book.id).join("\0");
  const selectedId = selection?.open && selection.layout === layout ? selection.id : null;

  function close() {
    setSelection((current) => current && { ...current, open: false });
    trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!selectedId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }
    // The placement is measured in viewport coordinates; return before that viewport changes.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    const shelf = window.matchMedia("(min-width: 768px)").matches
      ? trigger.current?.closest(".bookshelf")
      : null;
    shelf?.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      shelf?.removeEventListener("scroll", close);
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
    trigger.current = button;
    setSelection({
      id: book.id,
      layout,
      open: true,
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
          data-selected={selectedId === book.id}
          style={selection?.id === book.id ? selection.style : undefined}
        >
          <BookshelfBook
            book={book}
            index={index}
            selected={selectedId === book.id}
            onSelect={(button) => select(book, button)}
            onOpenBook={onOpenBook}
          />
        </li>
      ))}
    </ol>
  );
}
