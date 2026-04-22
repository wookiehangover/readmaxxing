import { describe, it, expect } from "vitest";
import { parseCursorsParam } from "../sync-cursors";
import type { EntityType, SyncCursor } from "../types";

// ---------------------------------------------------------------------------
// Pure parse helper — server-side entry point for the `cursors` query param
// ---------------------------------------------------------------------------

describe("parseCursorsParam", () => {
  it("returns epoch for every supported entity when the param is missing", () => {
    const { cursorsByEntity, error } = parseCursorsParam(null);
    expect(error).toBeUndefined();
    const entities: EntityType[] = [
      "book",
      "position",
      "highlight",
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
    expect(cursorsByEntity.position.getTime()).toBe(0);
    expect(cursorsByEntity.notebook.getTime()).toBe(0);
    expect(cursorsByEntity.chat_session.getTime()).toBe(0);
    expect(cursorsByEntity.chat_message.getTime()).toBe(0);
    expect(cursorsByEntity.settings.getTime()).toBe(0);
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

// ---------------------------------------------------------------------------
// Isolation property: two entities with different cursors pull only their
// own deltas. With the old single-`since` protocol, an entity that had
// fallen behind would drag every other entity's `since` back with it.
// ---------------------------------------------------------------------------

describe("per-entity cursor isolation", () => {
  it("one lagging entity does not rewind the others' `since`", () => {
    // Book cursor is far behind; highlight cursor is recent. The server must
    // query book from 10:00 and highlight from 14:00 — not min(10:00, 14:00)
    // for both.
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
    // Simulate the server-side filter: `get*ByUserSince` returns rows whose
    // updatedAt is strictly greater than `since`. If one entity falls behind,
    // rows for the other entity past that entity's own cursor must still be
    // excluded from a re-scan.
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

    // Book at its own cursor (10:00) surfaces the 11:00 row.
    expect(newBooks.map((r) => r.id)).toEqual(["b-new"]);
    // Highlight at its own cursor (14:00) only surfaces the 15:00 row —
    // the 13:00 row is NOT re-delivered just because book is behind.
    expect(newHighlights.map((r) => r.id)).toEqual(["h-new"]);
  });
});
