import { ReactStore } from "@augmentcode/themis/react-store";

import { createAnnotationsSelectors } from "~/lib/themis/annotations/annotations-selectors";
import { annotationsReducer } from "~/lib/themis/annotations/annotations-slice";
import type { AnnotationsState } from "~/lib/themis/annotations/annotations-types";
import type { BooksState } from "~/lib/themis/books/books-slice";
import { createBooksSelectors } from "~/lib/themis/books/books-selectors";
import { booksReducer } from "~/lib/themis/books/books-slice";
import { createWorkspaceRestoreSelectors } from "~/lib/themis/workspace-restore/workspace-restore-selectors";
import { workspaceRestoreReducer } from "~/lib/themis/workspace-restore/workspace-restore-slice";
import type { WorkspaceRestoreState } from "~/lib/themis/workspace-restore/workspace-restore-types";

export type AppStoreCore = ReactStore<
  { annotations: AnnotationsState; books: BooksState; workspaceRestore: WorkspaceRestoreState },
  {
    annotations: typeof annotationsReducer;
    books: typeof booksReducer;
    workspaceRestore: typeof workspaceRestoreReducer;
  }
>;

export function createAppStore() {
  const store = new ReactStore({
    annotations: annotationsReducer,
    books: booksReducer,
    workspaceRestore: workspaceRestoreReducer,
  });
  return Object.assign(store, {
    annotationsSelectors: createAnnotationsSelectors(store),
    booksSelectors: createBooksSelectors(store),
    workspaceRestoreSelectors: createWorkspaceRestoreSelectors(store),
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
