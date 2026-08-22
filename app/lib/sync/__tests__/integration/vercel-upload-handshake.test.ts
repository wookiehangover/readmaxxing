import { createRequire } from "node:module";
import { BlobError } from "@vercel/blob";
import { upload } from "@vercel/blob/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSyncEngine, type SyncEngine } from "../../sync-engine";
import { classifyBlobError, runUploadWithRetry } from "../../upload-retry";

const requireFromBlob = createRequire(
  createRequire(import.meta.url).resolve("@vercel/blob/client"),
);
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = requireFromBlob("undici") as {
  MockAgent: new () => {
    disableNetConnect(): void;
    get(origin: string): {
      intercept(options: { path: string; method: string }): {
        reply(callback: (options: { body: string }) => { statusCode: number; data: unknown }): {
          times(count: number): void;
        };
      };
    };
    close(): Promise<void>;
  };
  getGlobalDispatcher(): unknown;
  setGlobalDispatcher(dispatcher: unknown): void;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("integration: installed Vercel Blob client upload handshakes", () => {
  it("bounds real missing-owner HTTP 400 handshakes without expiring auth or stopping sync", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/sync/pull?")) {
        return Response.json({ changes: [], serverTimestamp: new Date().toISOString() });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let engine: SyncEngine;
    const onAuthExpired = vi.fn(() => engine.stopSync());
    engine = makeSyncEngine({ userId: "user-after-login", onAuthExpired });
    const stopSync = vi.spyOn(engine, "stopSync");
    engine.startSync();

    const previousDispatcher = getGlobalDispatcher();
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    const handshakeRequests: Array<{ bookId: string; type: string }> = [];
    const handshakeResponses: Array<{ status: number; body: { error: string } }> = [];
    const responseBody = { error: "Book not found or not owned by user" };
    mockAgent
      .get(window.location.origin)
      .intercept({ path: "/api/sync/files/upload", method: "POST" })
      .reply(({ body }) => {
        const event = JSON.parse(body) as { payload: { clientPayload: string } };
        handshakeRequests.push(JSON.parse(event.payload.clientPayload));
        const response = { status: 400, body: responseBody };
        handshakeResponses.push(response);
        return { statusCode: response.status, data: response.body };
      })
      .times(3);
    setGlobalDispatcher(mockAgent);

    try {
      const bookId = "real-sdk-missing-book";
      const performUpload = vi.fn(() =>
        upload(
          `books/user-after-login/${bookId}/book.epub`,
          new Blob(["signed-out book contents"], { type: "application/epub+zip" }),
          {
            access: "private",
            handleUploadUrl: "/api/sync/files/upload",
            clientPayload: JSON.stringify({ bookId, type: "file" }),
            contentType: "application/epub+zip",
          },
        ),
      );
      const onTransientRetry = vi.fn();
      const onGiveUp = vi.fn();

      const result = await runUploadWithRetry(
        performUpload,
        { onAuthExpired, onTransientRetry, onGiveUp },
        [0, 0],
        async () => {},
      );

      expect(result).toBeNull();
      expect(performUpload).toHaveBeenCalledTimes(3);
      expect(onTransientRetry).toHaveBeenCalledTimes(2);
      expect(onGiveUp).toHaveBeenCalledTimes(1);
      const sdkError = onGiveUp.mock.calls[0]?.[0] as Error;
      expect(sdkError).toBeInstanceOf(BlobError);
      expect(sdkError.message).toBe("Vercel Blob: Failed to  retrieve the client token");
      expect(classifyBlobError(sdkError)).toBe("transient");
      expect(onGiveUp).toHaveBeenCalledWith(sdkError, 3);
      expect(handshakeRequests).toEqual([
        { bookId, type: "file" },
        { bookId, type: "file" },
        { bookId, type: "file" },
      ]);
      expect(handshakeResponses).toEqual([
        { status: 400, body: { error: "Book not found or not owned by user" } },
        { status: 400, body: { error: "Book not found or not owned by user" } },
        { status: 400, body: { error: "Book not found or not owned by user" } },
      ]);
      expect(onAuthExpired).not.toHaveBeenCalled();
      expect(stopSync).not.toHaveBeenCalled();

      const pullRequestsBeforeRecovery = fetchMock.mock.calls.length;
      await engine.pullChanges();
      expect(fetchMock.mock.calls.length).toBeGreaterThan(pullRequestsBeforeRecovery);
      expect(onAuthExpired).not.toHaveBeenCalled();
      expect(stopSync).not.toHaveBeenCalled();
    } finally {
      setGlobalDispatcher(previousDispatcher);
      await mockAgent.close();
      engine.stopSync();
    }
  });
});
