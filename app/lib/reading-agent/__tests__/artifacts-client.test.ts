import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchReadingArtifacts,
  parseReadingArtifactsResponse,
  ReadingArtifactsError,
} from "../artifacts-client";

const outline = {
  content: "# Chapter 1\n\nSiddhartha leaves home.",
  revisionId: "revision-1",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const emptyBody = {
  bookId: "book-1",
  artifacts: { outline: null, characters: null, wiki: null },
};

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseReadingArtifactsResponse", () => {
  it("parses a complete artifacts payload", () => {
    expect(
      parseReadingArtifactsResponse({
        bookId: "book-1",
        artifacts: { outline, characters: null, wiki: null },
      }),
    ).toEqual({
      bookId: "book-1",
      artifacts: { outline, characters: null, wiki: null },
    });
  });

  it("rejects a missing or malformed outline head", () => {
    expect(() => parseReadingArtifactsResponse({ bookId: "book-1" })).toThrow(
      ReadingArtifactsError,
    );
    expect(() =>
      parseReadingArtifactsResponse({
        bookId: "book-1",
        artifacts: { outline: { content: 1 }, characters: null, wiki: null },
      }),
    ).toThrow(/Invalid outline artifact/);
  });
});

describe("fetchReadingArtifacts", () => {
  it("sends credentials and returns the parsed outline", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ bookId: "book-1", artifacts: { outline, characters: null, wiki: null } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(fetchReadingArtifacts("book 1")).resolves.toEqual({
      bookId: "book-1",
      artifacts: { outline, characters: null, wiki: null },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/books/book%201/artifacts", {
      credentials: "include",
    });
  });

  it("returns a typed 401 and treats an empty outline as null", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "auth_required" }), { status: 401 }),
    );
    await expect(fetchReadingArtifacts("book-1")).rejects.toMatchObject({
      code: "auth_required",
      status: 401,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(emptyBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchReadingArtifacts("book-1")).resolves.toEqual(emptyBody);
  });

  it("maps server and network failures", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Sync not configured" }), { status: 503 }),
    );
    await expect(fetchReadingArtifacts("book-1")).rejects.toMatchObject({ code: "unavailable" });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetchReadingArtifacts("book-1")).rejects.toMatchObject({
      code: "request_failed",
      status: 0,
    });
  });
});
