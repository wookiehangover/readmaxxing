import { useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { Search, X } from "lucide-react";
import { BookshelfStack } from "~/components/bookshelf/bookshelf-stack";
import { useAppStore } from "~/lib/themis/provider";
import { hydrateBooks } from "~/lib/themis/books/books-slice";
import type { WorkspaceSortBy } from "~/lib/settings";
import { filterBooks, sortBooks } from "~/lib/workspace-utils";

export function meta() {
  return [{ title: "Bookshelf — Readmaxxing" }];
}

export default function BookshelfRoute() {
  useSignals();
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks().value;
  const error = store.booksSelectors.selectBooksError().value;
  const lastOpenedMap = store.workspaceRestoreSelectors.selectLastOpenedMap().value;
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<WorkspaceSortBy>("author");
  const visibleBooks = sortBooks(filterBooks(books, query.trim()), sortBy, lastOpenedMap);

  return (
    <main className="bookshelf" aria-label="Bookshelf">
      <div className="bookshelf-content">
        <div className="bookshelf-toolbar">
          <div className="bookshelf-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search bookshelf"
              placeholder="Find a title or author"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <label className="bookshelf-sort">
            <span className="sr-only">Sort bookshelf</span>
            <select
              value={sortBy}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "author" || value === "title" || value === "recent") setSortBy(value);
              }}
            >
              <option value="author">By author</option>
              <option value="title">By title</option>
              <option value="recent">Recently read</option>
            </select>
          </label>
        </div>

        <p className="sr-only" role="status">
          {visibleBooks.length ? `${visibleBooks.length} books` : "No books found."}
        </p>

        {error ? (
          <div className="bookshelf-error" role="alert">
            <p>Couldn’t load books.</p>
            <button type="button" onClick={() => store.dispatch(hydrateBooks())}>
              Try again
            </button>
          </div>
        ) : (
          <BookshelfStack books={visibleBooks} />
        )}
      </div>
    </main>
  );
}
