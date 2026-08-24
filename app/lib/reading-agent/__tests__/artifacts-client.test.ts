import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_BOOK_ID } from "~/lib/onboarding/demo-content";
import {
  fetchReadingArtifacts,
  parseReadingArtifactsResponse,
  ReadingArtifactsError,
  saveReadingOutline,
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
  it("does not request authenticated artifacts for the reserved demo book", async () => {
    await expect(fetchReadingArtifacts(DEMO_BOOK_ID)).rejects.toMatchObject({
      code: "auth_required",
      status: 401,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

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

describe("saveReadingOutline", () => {
  it("does not save authenticated artifacts for the reserved demo book", async () => {
    await expect(saveReadingOutline(DEMO_BOOK_ID, outline.content)).rejects.toMatchObject({
      code: "auth_required",
      status: 401,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts outline content with credentials and returns the saved head", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ bookId: "book-1", artifact: outline }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(saveReadingOutline("book 1", outline.content)).resolves.toEqual({
      bookId: "book-1",
      artifact: outline,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/books/book%201/artifacts");
    expect(init).toMatchObject({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ content: outline.content }),
    });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("maps a rejected payload without returning a saved head", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid" }), { status: 400 }),
    );

    await expect(saveReadingOutline("book-1", outline.content)).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });
});
