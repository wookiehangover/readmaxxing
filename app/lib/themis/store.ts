import { ReactStore } from "@augmentcode/themis/react-store";

import type { BooksState } from "~/lib/themis/books/books-slice";
import { createBooksSelectors } from "~/lib/themis/books/books-selectors";
import { booksReducer } from "~/lib/themis/books/books-slice";
import { createWorkspaceRestoreSelectors } from "~/lib/themis/workspace-restore/workspace-restore-selectors";
import { workspaceRestoreReducer } from "~/lib/themis/workspace-restore/workspace-restore-slice";
import type { WorkspaceRestoreState } from "~/lib/themis/workspace-restore/workspace-restore-types";

export type AppStoreCore = ReactStore<
  { books: BooksState; workspaceRestore: WorkspaceRestoreState },
  { books: typeof booksReducer; workspaceRestore: typeof workspaceRestoreReducer }
>;

export function createAppStore() {
  const store = new ReactStore({ books: booksReducer, workspaceRestore: workspaceRestoreReducer });
  return Object.assign(store, {
    booksSelectors: createBooksSelectors(store),
    workspaceRestoreSelectors: createWorkspaceRestoreSelectors(store),
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
