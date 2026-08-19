import { Effect } from "effect";
import { call, put, takeLatest } from "typed-redux-saga";

import { AppRuntime } from "~/lib/effect-runtime";
import { BookService } from "~/lib/stores/book-store";
import { booksHydrateFailed, booksHydrated, hydrateBooks } from "~/lib/themis/books/books-slice";

async function loadBooks() {
  return AppRuntime.runPromise(BookService.pipe(Effect.andThen((service) => service.getBooks())));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function* hydrateBooksSaga() {
  try {
    const books = yield* call(loadBooks);
    yield* put(booksHydrated(books));
  } catch (error) {
    yield* put(booksHydrateFailed(errorMessage(error)));
  }
}

export function* booksSaga() {
  yield* takeLatest(hydrateBooks, hydrateBooksSaga);
}
