import { Data } from "effect";

export class StorageError extends Data.TaggedError("StorageError")<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}

export class BookNotFoundError extends Data.TaggedError("BookNotFoundError")<{
  readonly bookId: string;
}> {}

export class EpubParseError extends Data.TaggedError("EpubParseError")<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}

export class HighlightError extends Data.TaggedError("HighlightError")<{
  readonly operation: string;
  readonly highlightId?: string;
  readonly cause?: unknown;
}> {}

export class NotebookError extends Data.TaggedError("NotebookError")<{
  readonly operation: string;
  readonly bookId?: string;
  readonly cause?: unknown;
}> {}

export class PositionError extends Data.TaggedError("PositionError")<{
  readonly operation: string;
  readonly bookId: string;
  readonly cause?: unknown;
}> {}
