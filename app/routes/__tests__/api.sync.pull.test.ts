import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/database/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1" })),
}));
vi.mock("~/lib/database/annotation/highlight", () => ({
  getHighlightsByUserSince: vi.fn(async () => []),
}));
vi.mock("~/lib/database/annotation/notebook", () => ({
  getNotebooksByUserSince: vi.fn(async () => []),
}));
vi.mock("~/lib/database/bookmark/bookmark", () => ({
  getBookmarksByUser: vi.fn(async () => []),
}));
vi.mock("~/lib/database/book/book", () => ({
  getBooksByUserSince: vi.fn(async () => []),
}));
vi.mock("~/lib/database/book/reading-position", () => ({
  getPositionsByUserSince: vi.fn(async () => []),
}));
vi.mock("~/lib/database/chat/chat-session", () => ({
  getSessionsByUserSince: vi.fn(async () => []),
  getMessagesByUserSince: vi.fn(async () => []),
}));
vi.mock("~/lib/database/settings/user-settings", () => ({
  getSettingsSince: vi.fn(async () => null),
}));

import { getBooksByUserSince } from "~/lib/database/book/book";
import { encodePullCursor } from "~/lib/sync/sync-cursors";
import { loader } from "~/routes/api.sync.pull";

describe("sync pull pagination", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/readmax-test");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps microsecond timestamps in keyset cursors without exposing internal row fields", async () => {
    const previousTimestamp = "2026-04-22 12:00:00.123001+00";
    const firstTimestamp = "2026-04-22 12:00:00.123456+00";
    const secondTimestamp = "2026-04-22 12:00:00.123789+00";

    vi.mocked(getBooksByUserSince).mockResolvedValueOnce([
      { id: "book-1", updatedAt: new Date(firstTimestamp), cursorTimestamp: firstTimestamp },
      { id: "book-2", updatedAt: new Date(secondTimestamp), cursorTimestamp: secondTimestamp },
    ] as Awaited<ReturnType<typeof getBooksByUserSince>>);

    const cursors = [
      {
        entityType: "book",
        cursor: encodePullCursor(new Date(previousTimestamp), "book-0", previousTimestamp),
      },
    ];
    const params = new URLSearchParams({
      entityType: "book",
      limit: "1",
      cursors: JSON.stringify(cursors),
    });

    const response = await loader({
      request: new Request(`https://readmax.test/api/sync/pull?${params.toString()}`),
    });
    const body = await response.json();

    expect(getBooksByUserSince).toHaveBeenCalledWith(
      "user-1",
      new Date(previousTimestamp),
      2,
      "book-0",
      previousTimestamp,
    );
    expect(body.changes).toEqual([
      {
        entity: "book",
        records: [{ id: "book-1", updatedAt: "2026-04-22T12:00:00.123Z" }],
        cursor: JSON.stringify({ t: firstTimestamp, id: "book-1" }),
        hasMore: true,
      },
    ]);
  });
});
