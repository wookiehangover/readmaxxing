import { useState, type CSSProperties } from "react";
import { BookshelfMenu } from "~/components/bookshelf/bookshelf-menu";
import { Link, useNavigate } from "react-router";
import { CoverImage } from "~/components/book-grid/cover-image";
import { getBookReadingPath } from "~/lib/reading-route";
import type { BookMeta } from "~/lib/stores/book-store";
import { readCoverColors, type CoverColors } from "~/components/bookshelf/cover-color";
import { useBookTilt } from "~/hooks/use-book-tilt";

// Paired cloth and ink colors keep every generated spine readable, including books without covers.
const CLOTH_COLORS = [
  ["#c8b77e", "#29281e"],
  ["#344b50", "#eee7cd"],
  ["#954c3b", "#fff0d6"],
  ["#ded4b8", "#38382d"],
  ["#425943", "#f0e9cf"],
  ["#b98355", "#241e18"],
  ["#343b56", "#eee4d1"],
  ["#77516a", "#f9ecd9"],
] as const;

export function BookshelfBook({
  book,
  index,
  onOpenBook,
  selected,
  active,
  onSelect,
}: {
  book: BookMeta;
  index: number;
  selected: boolean;
  active: boolean;
  onSelect: (button: HTMLButtonElement) => void;
  onOpenBook?: (book: BookMeta) => void | Promise<void>;
}) {
  const [coverColors, setCoverColors] = useState<CoverColors | null>(null);
  const navigate = useNavigate();
  const { resetTilt, ...tiltEvents } = useBookTilt(selected);
  function openBook() {
    if (onOpenBook) void onOpenBook(book);
    else void navigate(getBookReadingPath(book.id));
  }
  const colorIndex =
    Array.from(book.id).reduce(
      (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
      0,
    ) % CLOTH_COLORS.length;
  const hasCover = Boolean(book.coverImage || book.remoteCoverUrl);
  const [fallbackCloth, fallbackInk] = CLOTH_COLORS[colorIndex];
  const cloth = hasCover && coverColors ? coverColors.cloth : fallbackCloth;
  const ink = hasCover && coverColors ? coverColors.ink : fallbackInk;

  return (
    <>
      <button
        type="button"
        className="bookshelf-book"
        aria-label={`Select ${book.title}${book.author ? ` by ${book.author}` : ""}`}
        aria-pressed={selected}
        aria-description={selected ? "Activate again to open this book" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          resetTilt(event.currentTarget.querySelector(".bookshelf-volume")!);
          if (selected) openBook();
          else onSelect(event.currentTarget);
        }}
        style={{ "--book-cloth": cloth, "--book-ink": ink, "--book-order": index } as CSSProperties}
      >
        {/* Rebuild the perspective root with its faces; WebKit flattens faces added later. */}
        <span className="bookshelf-scene" data-active={active} key={active ? "active" : "inactive"}>
          <span className="bookshelf-volume" {...tiltEvents}>
            {active && (
              <span className="bookshelf-top" aria-hidden="true">
                <span className="bookshelf-cover">
                  {hasCover ? (
                    <CoverImage
                      coverImage={book.coverImage}
                      remoteCoverUrl={book.remoteCoverUrl}
                      bookId={book.id}
                      updatedAt={book.updatedAt}
                      alt=""
                      crossOrigin="anonymous"
                      onLoad={(event) => setCoverColors(readCoverColors(event.currentTarget))}
                    />
                  ) : (
                    <span className="bookshelf-cover-fallback">
                      <span>{book.title}</span>
                      <small>{book.author}</small>
                    </span>
                  )}
                </span>
              </span>
            )}
            {active && (
              <>
                <span className="bookshelf-back" aria-hidden="true" />
                <span className="bookshelf-pages" aria-hidden="true" />
                <span className="bookshelf-page-end bookshelf-page-end-start" aria-hidden="true" />
                <span className="bookshelf-page-end bookshelf-page-end-finish" aria-hidden="true" />
              </>
            )}
            <span className="bookshelf-spine">
              <span className="bookshelf-author">{book.author || "Unknown author"}</span>
              <span className="bookshelf-book-title">{book.title}</span>
            </span>
          </span>
        </span>
      </button>
      <div
        className="bookshelf-actions"
        aria-hidden={!selected}
        inert={!selected}
        onClick={(event) => event.stopPropagation()}
      >
        <Link
          to={getBookReadingPath(book.id)}
          className="bookshelf-read"
          aria-label={`Read ${book.title}${book.author ? ` by ${book.author}` : ""}`}
          aria-hidden={!selected}
          tabIndex={selected ? 0 : -1}
          onClick={(event) => {
            if (
              !onOpenBook ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            void onOpenBook(book);
          }}
        >
          Read book
        </Link>
        {selected && <BookshelfMenu book={book} />}
      </div>
    </>
  );
}
