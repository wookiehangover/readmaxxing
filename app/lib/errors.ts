type OperationProps = { readonly operation: string; readonly cause?: unknown };

export interface TaggedError {
  readonly _tag: string;
  readonly message: string;
  readonly operation?: string;
  readonly bookId?: string;
  readonly highlightId?: string;
  readonly bookmarkId?: string;
}

export function toTaggedError(error: unknown): TaggedError {
  const source =
    error !== null && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const _tag =
    typeof source._tag === "string"
      ? source._tag
      : error instanceof Error && error.name
        ? error.name
        : "Error";
  const message =
    error instanceof Error
      ? error.message
      : typeof source.message === "string"
        ? source.message
        : String(error);

  return {
    _tag,
    message,
    ...(typeof source.operation === "string" ? { operation: source.operation } : {}),
    ...(typeof source.bookId === "string" ? { bookId: source.bookId } : {}),
    ...(typeof source.highlightId === "string" ? { highlightId: source.highlightId } : {}),
    ...(typeof source.bookmarkId === "string" ? { bookmarkId: source.bookmarkId } : {}),
  };
}

class AppError<Tag extends string, Props extends object> extends Error {
  readonly _tag: Tag;

  constructor(tag: Tag, props: Props) {
    const cause = "cause" in props ? props.cause : undefined;
    super(tag, { cause });
    this.name = tag;
    this._tag = tag;
    Object.assign(this, props);
  }
}

function operationError<Tag extends string>(tag: Tag) {
  return class extends AppError<Tag, OperationProps> {
    declare readonly operation: string;
    declare readonly cause?: unknown;

    constructor(props: OperationProps) {
      super(tag, props);
    }
  };
}

export class StorageError extends operationError("StorageError") {}

export class BookNotFoundError extends AppError<"BookNotFoundError", { readonly bookId: string }> {
  declare readonly bookId: string;

  constructor(props: { readonly bookId: string }) {
    super("BookNotFoundError", props);
  }
}

export class EpubParseError extends operationError("EpubParseError") {}

export class HighlightError extends AppError<
  "HighlightError",
  OperationProps & { readonly highlightId?: string }
> {
  declare readonly operation: string;
  declare readonly highlightId?: string;

  constructor(props: OperationProps & { readonly highlightId?: string }) {
    super("HighlightError", props);
  }
}

export class BookmarkError extends AppError<
  "BookmarkError",
  OperationProps & { readonly bookmarkId?: string }
> {
  declare readonly operation: string;
  declare readonly bookmarkId?: string;

  constructor(props: OperationProps & { readonly bookmarkId?: string }) {
    super("BookmarkError", props);
  }
}

export class NotebookError extends AppError<
  "NotebookError",
  OperationProps & { readonly bookId?: string }
> {
  declare readonly operation: string;
  declare readonly bookId?: string;

  constructor(props: OperationProps & { readonly bookId?: string }) {
    super("NotebookError", props);
  }
}

export class PositionError extends AppError<
  "PositionError",
  OperationProps & { readonly bookId: string }
> {
  declare readonly operation: string;
  declare readonly bookId: string;

  constructor(props: OperationProps & { readonly bookId: string }) {
    super("PositionError", props);
  }
}

export class ReadingHistoryError extends AppError<
  "ReadingHistoryError",
  OperationProps & { readonly bookId: string }
> {
  declare readonly operation: string;
  declare readonly bookId: string;

  constructor(props: OperationProps & { readonly bookId: string }) {
    super("ReadingHistoryError", props);
  }
}

export class WorkspaceError extends operationError("WorkspaceError") {}
export class StandardEbooksError extends operationError("StandardEbooksError") {}
export class ChatError extends operationError("ChatError") {}
export class PdfParseError extends operationError("PdfParseError") {}
export class DecodeError extends operationError("DecodeError") {}
export class AuthError extends operationError("AuthError") {}
export class SyncError extends operationError("SyncError") {}
