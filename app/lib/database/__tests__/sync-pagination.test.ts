import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("../pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

import { getHighlightsByUserSince } from "../annotation/highlight";
import { getNotebooksByUserSince } from "../annotation/notebook";
import { getBooksByUserSince } from "../book/book";
import { getPositionsByUserSince } from "../book/reading-position";
import { getBookmarksByUser } from "../bookmark/bookmark";
import { getMessagesByUserSince, getSessionsByUserSince } from "../chat/chat-session";

const exactTimestamp = "2026-04-22 12:00:00.123456+00";
const cursor = new Date(exactTimestamp);

const queries = [
  ["books", () => getBooksByUserSince("user-1", cursor, 251, null, exactTimestamp)],
  ["reading positions", () => getPositionsByUserSince("user-1", cursor, 251, null, exactTimestamp)],
  ["highlights", () => getHighlightsByUserSince("user-1", cursor, 251, null, exactTimestamp)],
  ["bookmarks", () => getBookmarksByUser("user-1", cursor, 251, null, exactTimestamp)],
  ["notebooks", () => getNotebooksByUserSince("user-1", cursor, 251, null, exactTimestamp)],
  ["chat sessions", () => getSessionsByUserSince("user-1", cursor, 251, null, exactTimestamp)],
  ["chat messages", () => getMessagesByUserSince("user-1", cursor, 251, null, exactTimestamp)],
] as const;

describe("paginated sync queries", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it.each(queries)(
    "keeps %s cursor parameters typed and microsecond-accurate",
    async (_, query) => {
      await query();

      const generatedQuery = queryMock.mock.calls[0][0] as { text: string; values: unknown[] };
      expect(generatedQuery.text).not.toMatch(/\$\d+\s+IS NOT NULL/);
      expect(generatedQuery.text).toContain('::text AS "cursorTimestamp"');
      expect(generatedQuery.values.filter((value) => value === exactTimestamp)).toHaveLength(2);
      expect(generatedQuery.values).toContain(null);
    },
  );
});
