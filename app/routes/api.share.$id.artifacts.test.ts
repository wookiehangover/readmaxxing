// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/database/share/share-link", () => ({ getShareLink: vi.fn() }));
vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  getCurrentReadingArtifacts: vi.fn(),
}));

import { getCurrentReadingArtifacts } from "~/lib/database/reading-artifact/reading-artifact";
import { getShareLink } from "~/lib/database/share/share-link";
import { loader } from "~/routes/api.share.$id.artifacts";

const getShareLinkMock = getShareLink as ReturnType<typeof vi.fn>;
const getArtifactsMock = getCurrentReadingArtifacts as ReturnType<typeof vi.fn>;
const originalDatabaseUrl = process.env.DATABASE_URL;

const shareLink = {
  id: "share-1",
  userId: "user-1",
  bookId: "book-1",
  maxUses: null,
  useCount: 0,
  shareChats: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: null,
};

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://example";
  getShareLinkMock.mockReset().mockResolvedValue(shareLink);
  getArtifactsMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("shared artifacts API", () => {
  it("returns only the sharer's current outline without requiring shared chats", async () => {
    getArtifactsMock.mockResolvedValue([
      {
        userId: "user-1",
        bookId: "book-1",
        kind: "characters",
        content: "Private characters",
        revisionId: "revision-characters",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        userId: "user-1",
        bookId: "book-1",
        kind: "outline",
        content: "## Shared outline",
        revisionId: "revision-outline",
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);

    const response = await loader({ params: { id: "share-1" } });

    expect(response.status).toBe(200);
    expect(getArtifactsMock).toHaveBeenCalledWith("user-1", "book-1");
    await expect(response.json()).resolves.toEqual({
      bookId: "book-1",
      artifact: {
        content: "## Shared outline",
        revisionId: "revision-outline",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });
  });

  it("returns null when the sharer has no outline", async () => {
    const response = await loader({ params: { id: "share-1" } });
    await expect(response.json()).resolves.toEqual({ bookId: "book-1", artifact: null });
  });

  it.each([
    ["missing", null, 404],
    ["expired", { ...shareLink, expiresAt: new Date("2020-01-01T00:00:00Z") }, 410],
    ["exhausted", { ...shareLink, maxUses: 1, useCount: 1 }, 410],
  ])("rejects a %s share link", async (_, link, status) => {
    getShareLinkMock.mockResolvedValue(link);

    const response = await loader({ params: { id: "share-1" } });

    expect(response.status).toBe(status);
    expect(getArtifactsMock).not.toHaveBeenCalled();
  });
});
