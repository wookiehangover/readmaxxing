import { describe, it, expect } from "vitest";
import { encodePullCursor, parseCursorsParam } from "../sync-cursors";
import type { EntityType, SyncCursor } from "../types";

describe("parseCursorsParam", () => {
  it("returns epoch for every supported entity when the param is missing", () => {
    const { cursorsByEntity, error } = parseCursorsParam(null);
    expect(error).toBeUndefined();
    const entities: EntityType[] = [
      "book",
      "position",
      "highlight",
      "bookmark",
      "notebook",
      "chat_session",
      "chat_message",
      "settings",
    ];
    for (const e of entities) {
      expect(cursorsByEntity[e].getTime()).toBe(0);
    }
  });

  it("parses per-entity cursors and leaves unlisted entities at epoch", () => {
    const payload: SyncCursor[] = [
      { entityType: "book", cursor: "2026-04-22T12:00:00.000Z" },
      { entityType: "highlight", cursor: "2026-04-22T13:00:00.000Z" },
    ];
    const { cursorsByEntity, error } = parseCursorsParam(JSON.stringify(payload));
    expect(error).toBeUndefined();
    expect(cursorsByEntity.book.toISOString()).toBe("2026-04-22T12:00:00.000Z");
    expect(cursorsByEntity.highlight.toISOString()).toBe("2026-04-22T13:00:00.000Z");
    expect(cursorsByEntity.bookmark.getTime()).toBe(0);
    expect(cursorsByEntity.position.getTime()).toBe(0);
    expect(cursorsByEntity.notebook.getTime()).toBe(0);
    expect(cursorsByEntity.chat_session.getTime()).toBe(0);
    expect(cursorsByEntity.chat_message.getTime()).toBe(0);
    expect(cursorsByEntity.settings.getTime()).toBe(0);
  });

  it("parses encoded keyset cursors with a timestamp and row id", () => {
    const payload: SyncCursor[] = [
      {
        entityType: "book",
        cursor: encodePullCursor(new Date("2026-04-22T12:00:00.000Z"), "book-1"),
      },
    ];

    const { cursorsByEntity, cursorIdsByEntity, error } = parseCursorsParam(
      JSON.stringify(payload),
    );

    expect(error).toBeUndefined();
    expect(cursorsByEntity.book.toISOString()).toBe("2026-04-22T12:00:00.000Z");
    expect(cursorIdsByEntity.book).toBe("book-1");
    expect(cursorIdsByEntity.highlight).toBeNull();
  });

  it("preserves PostgreSQL microseconds when parsing an encoded keyset cursor", () => {
    const exactTimestamp = "2026-04-22 12:00:00.123456+00";
    const payload: SyncCursor[] = [
      {
        entityType: "book",
        cursor: encodePullCursor(new Date(exactTimestamp), "book-1", exactTimestamp),
      },
    ];

    const { cursorsByEntity, cursorTimestampsByEntity, cursorIdsByEntity, error } =
      parseCursorsParam(JSON.stringify(payload));

    expect(error).toBeUndefined();
    expect(cursorsByEntity.book.toISOString()).toBe("2026-04-22T12:00:00.123Z");
    expect(cursorTimestampsByEntity.book).toBe(exactTimestamp);
    expect(cursorIdsByEntity.book).toBe("book-1");
  });

  it("returns a 400-ready error for malformed JSON", () => {
    const { error } = parseCursorsParam("not-json");
    expect(error).toMatch(/invalid.*json/i);
  });

  it("rejects non-array payloads", () => {
    const { error } = parseCursorsParam(JSON.stringify({ book: "2026-04-22T12:00:00.000Z" }));
    expect(error).toMatch(/must be a json array/i);
  });

  it("rejects unknown entity types", () => {
    const payload = [{ entityType: "unknown", cursor: "2026-04-22T12:00:00.000Z" }];
    const { error } = parseCursorsParam(JSON.stringify(payload));
    expect(error).toMatch(/unknown entitytype/i);
  });

  it("rejects entries with a non-ISO cursor", () => {
    const payload = [{ entityType: "book", cursor: "not-a-date" }];
    const { error } = parseCursorsParam(JSON.stringify(payload));
    expect(error).toMatch(/invalid cursor timestamp/i);
  });

  it("rejects entries missing the cursor field", () => {
    const payload = [{ entityType: "book" }];
    const { error } = parseCursorsParam(JSON.stringify(payload));
    expect(error).toMatch(/missing cursor/i);
  });
});

describe("per-entity cursor isolation", () => {
  it("one lagging entity does not rewind the others' `since`", () => {
    const payload: SyncCursor[] = [
      { entityType: "book", cursor: "2026-04-22T10:00:00.000Z" },
      { entityType: "highlight", cursor: "2026-04-22T14:00:00.000Z" },
    ];
    const { cursorsByEntity } = parseCursorsParam(JSON.stringify(payload));

    expect(cursorsByEntity.book.toISOString()).toBe("2026-04-22T10:00:00.000Z");
    expect(cursorsByEntity.highlight.toISOString()).toBe("2026-04-22T14:00:00.000Z");
    expect(cursorsByEntity.book.getTime()).not.toBe(cursorsByEntity.highlight.getTime());
  });

  it("only-book-has-a-cursor case: highlight starts from epoch, book from its own cursor", () => {
    const payload: SyncCursor[] = [{ entityType: "book", cursor: "2026-04-22T10:00:00.000Z" }];
    const { cursorsByEntity } = parseCursorsParam(JSON.stringify(payload));

    expect(cursorsByEntity.book.toISOString()).toBe("2026-04-22T10:00:00.000Z");
    expect(cursorsByEntity.highlight.getTime()).toBe(0);
  });

  it("filters records correctly when used by a stand-in `get*ByUserSince`", () => {
    const payload: SyncCursor[] = [
      { entityType: "book", cursor: "2026-04-22T10:00:00.000Z" },
      { entityType: "highlight", cursor: "2026-04-22T14:00:00.000Z" },
    ];
    const { cursorsByEntity } = parseCursorsParam(JSON.stringify(payload));

    const bookRows = [
      { id: "b-old", updatedAt: new Date("2026-04-22T09:00:00.000Z") },
      { id: "b-new", updatedAt: new Date("2026-04-22T11:00:00.000Z") },
    ];
    const highlightRows = [
      { id: "h-old", updatedAt: new Date("2026-04-22T13:00:00.000Z") },
      { id: "h-new", updatedAt: new Date("2026-04-22T15:00:00.000Z") },
    ];

    const filterSince = <T extends { updatedAt: Date }>(rows: T[], since: Date) =>
      rows.filter((r) => r.updatedAt.getTime() > since.getTime());

    const newBooks = filterSince(bookRows, cursorsByEntity.book);
    const newHighlights = filterSince(highlightRows, cursorsByEntity.highlight);

    expect(newBooks.map((r) => r.id)).toEqual(["b-new"]);
    expect(newHighlights.map((r) => r.id)).toEqual(["h-new"]);
  });
});
