import { BookshelfBook } from "~/components/bookshelf/bookshelf-book";
import type { BookMeta } from "~/lib/stores/book-store";
import "~/components/bookshelf/bookshelf.css";

interface BookshelfStackProps {
  books: BookMeta[];
  onOpenBook?: (book: BookMeta) => void | Promise<void>;
}

export function BookshelfStack({ books, onOpenBook }: BookshelfStackProps) {
  return (
    <ol className="bookshelf-stack" aria-label="Your books">
      {books.map((book, index) => (
        <li key={book.id}>
          <BookshelfBook book={book} index={index} onOpenBook={onOpenBook} />
        </li>
      ))}
    </ol>
  );
}
