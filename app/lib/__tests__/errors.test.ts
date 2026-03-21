import { describe, it, expect } from "vitest";
import {
  StorageError,
  BookNotFoundError,
  EpubParseError,
  HighlightError,
  NotebookError,
  PositionError,
} from "../errors";

describe("StorageError", () => {
  it("has correct _tag", () => {
    const err = new StorageError({ operation: "save" });
    expect(err._tag).toBe("StorageError");
  });

  it("stores required operation field", () => {
    const err = new StorageError({ operation: "delete" });
    expect(err.operation).toBe("delete");
  });

  it("stores optional cause", () => {
    const cause = new Error("disk full");
    const err = new StorageError({ operation: "write", cause });
    expect(err.cause).toBe(cause);
  });

  it("cause defaults to undefined", () => {
    const err = new StorageError({ operation: "read" });
    expect(err.cause).toBeUndefined();
  });
});

describe("BookNotFoundError", () => {
  it("has correct _tag", () => {
    const err = new BookNotFoundError({ bookId: "abc-123" });
    expect(err._tag).toBe("BookNotFoundError");
  });

  it("stores required bookId field", () => {
    const err = new BookNotFoundError({ bookId: "xyz-789" });
    expect(err.bookId).toBe("xyz-789");
  });
});

describe("EpubParseError", () => {
  it("has correct _tag", () => {
    const err = new EpubParseError({ operation: "parse" });
    expect(err._tag).toBe("EpubParseError");
  });

  it("stores required operation field", () => {
    const err = new EpubParseError({ operation: "extractMetadata" });
    expect(err.operation).toBe("extractMetadata");
  });

  it("stores optional cause", () => {
    const cause = new TypeError("invalid xml");
    const err = new EpubParseError({ operation: "parse", cause });
    expect(err.cause).toBe(cause);
  });

  it("cause defaults to undefined", () => {
    const err = new EpubParseError({ operation: "parse" });
    expect(err.cause).toBeUndefined();
  });
});

describe("HighlightError", () => {
  it("has correct _tag", () => {
    const err = new HighlightError({ operation: "create" });
    expect(err._tag).toBe("HighlightError");
  });

  it("stores required operation field", () => {
    const err = new HighlightError({ operation: "delete" });
    expect(err.operation).toBe("delete");
  });

  it("stores optional highlightId", () => {
    const err = new HighlightError({ operation: "get", highlightId: "h-1" });
    expect(err.highlightId).toBe("h-1");
  });

  it("stores optional cause", () => {
    const cause = new Error("not found");
    const err = new HighlightError({ operation: "get", cause });
    expect(err.cause).toBe(cause);
  });

  it("optional fields default to undefined", () => {
    const err = new HighlightError({ operation: "list" });
    expect(err.highlightId).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});

describe("NotebookError", () => {
  it("has correct _tag", () => {
    const err = new NotebookError({ operation: "save" });
    expect(err._tag).toBe("NotebookError");
  });

  it("stores required operation field", () => {
    const err = new NotebookError({ operation: "load" });
    expect(err.operation).toBe("load");
  });

  it("stores optional bookId", () => {
    const err = new NotebookError({ operation: "save", bookId: "b-1" });
    expect(err.bookId).toBe("b-1");
  });

  it("stores optional cause", () => {
    const cause = new Error("serialization failed");
    const err = new NotebookError({ operation: "save", cause });
    expect(err.cause).toBe(cause);
  });

  it("optional fields default to undefined", () => {
    const err = new NotebookError({ operation: "list" });
    expect(err.bookId).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});

describe("PositionError", () => {
  it("has correct _tag", () => {
    const err = new PositionError({ operation: "save", bookId: "b-1" });
    expect(err._tag).toBe("PositionError");
  });

  it("stores required fields", () => {
    const err = new PositionError({ operation: "restore", bookId: "b-2" });
    expect(err.operation).toBe("restore");
    expect(err.bookId).toBe("b-2");
  });

  it("stores optional cause", () => {
    const cause = new Error("invalid cfi");
    const err = new PositionError({ operation: "save", bookId: "b-1", cause });
    expect(err.cause).toBe(cause);
  });

  it("cause defaults to undefined", () => {
    const err = new PositionError({ operation: "save", bookId: "b-1" });
    expect(err.cause).toBeUndefined();
  });
});

describe("error discrimination", () => {
  it("errors have distinct _tag values", () => {
    const tags = [
      new StorageError({ operation: "x" })._tag,
      new BookNotFoundError({ bookId: "x" })._tag,
      new EpubParseError({ operation: "x" })._tag,
      new HighlightError({ operation: "x" })._tag,
      new NotebookError({ operation: "x" })._tag,
      new PositionError({ operation: "x", bookId: "x" })._tag,
    ];
    expect(new Set(tags).size).toBe(6);
  });
});
