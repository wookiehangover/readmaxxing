import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, clear, get, set } from "idb-keyval";

vi.mock("../remap", () => ({
  remapBookId: vi.fn(async () => {}),
}));

import { remapBookId } from "../remap";
import { mergeBookRecord } from "../sync-engine";

const remapSpy = remapBookId as unknown as ReturnType<typeof vi.fn>;

// Must match the IDB db/store names used in sync-engine.ts.
const bookStore = createStore("ebook-reader-db", "books");

beforeEach(async () => {
  remapSpy.mockClear();
  await clear(bookStore);
});

describe("mergeBookRecord pull-path dedup", () => {
  it("invokes remapBookId(localId, incomingId) when a local book shares fileHash under a different id", async () => {
    await set(
      "local-1",
      {
        id: "local-1",
        title: "Local copy",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "remote-2",
      title: "Remote copy",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
    });

    expect(remapSpy).toHaveBeenCalledTimes(1);
    expect(remapSpy).toHaveBeenCalledWith("local-1", "remote-2");

    // Local record still present (real remap, which would tombstone it, is mocked).
    const localAfter = await get<Record<string, unknown>>("local-1", bookStore);
    expect(localAfter).toBeDefined();
    expect(localAfter?.fileHash).toBe("abc-hash");

    // The canonical (incoming) record is now stored under the remote id.
    const canonical = await get<Record<string, unknown>>("remote-2", bookStore);
    expect(canonical).toBeDefined();
    expect(canonical?.fileHash).toBe("abc-hash");
    expect(canonical?.id).toBe("remote-2");
  });

  it("does not invoke remapBookId when no local book matches the incoming fileHash", async () => {
    await set(
      "local-1",
      {
        id: "local-1",
        title: "Different book",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "different-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "remote-2",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
    });

    expect(remapSpy).not.toHaveBeenCalled();
  });

  it("does not invoke remapBookId when incoming record shares the same id as the local one", async () => {
    await set(
      "same-id",
      {
        id: "same-id",
        title: "Local",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "same-id",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
    });

    expect(remapSpy).not.toHaveBeenCalled();
  });

  it("does not invoke remapBookId for tombstoned incoming records even when hash matches", async () => {
    await set(
      "local-1",
      {
        id: "local-1",
        title: "Local",
        author: "A",
        coverImage: null,
        format: "epub",
        fileHash: "abc-hash",
        updatedAt: 100,
      },
      bookStore,
    );

    await mergeBookRecord({
      id: "remote-2",
      title: "Remote",
      author: "A",
      format: "epub",
      fileHash: "abc-hash",
      updatedAt: 200,
      deletedAt: 250,
    });

    expect(remapSpy).not.toHaveBeenCalled();
  });
});
