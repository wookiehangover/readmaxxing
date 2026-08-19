type OperationProps = { readonly operation: string; readonly cause?: unknown };

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
