import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";
import type { JSONContent } from "@tiptap/react";

import type { TaggedError } from "~/lib/errors";
import type { Highlight, Notebook } from "~/lib/stores/annotations-store";

export type HighlightUpdate = Partial<Omit<Highlight, "id" | "bookId" | "createdAt">>;
export type HighlightCompletedCallback = (highlight: Highlight) => void;
export type DeleteHighlightCompletedCallback = () => void;
export type NotebookCompletedCallback = (notebook: Notebook) => void;
export type AnnotationFailedCallback = (error: string) => void;

export interface AnnotationsState {
  highlights: Collection<Highlight, "id">;
  notebooks: Collection<Notebook, "bookId">;
  loadingBookIds: string[];
  loadedBookIds: string[];
  errorsByBookId: Record<string, TaggedError>;
}

export interface NotebookUpdateRequest {
  bookId: string;
  content: JSONContent;
  immediate?: boolean;
  onCompleted?: NotebookCompletedCallback;
  onFailed?: AnnotationFailedCallback;
}
