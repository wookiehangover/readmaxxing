import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readLocalFile,
  useLocalFileStorage,
  writeLocalFile,
  type LocalFileKind,
} from "../local-file-storage.server";

const testUserIds = new Set<string>();

function createUserId(): string {
  const userId = `local-storage-test-${randomUUID()}`;
  testUserIds.add(userId);
  return userId;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    [...testUserIds].map((userId) =>
      rm(join(process.cwd(), "data", "blob", userId), { recursive: true, force: true }),
    ),
  );
  testUserIds.clear();
});

describe("useLocalFileStorage", () => {
  it.each([
    ["development", true],
    ["production", false],
    ["test", false],
  ])("defaults NODE_ENV=%s to local=%s", (nodeEnv, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("BLOB_STORAGE_BACKEND", "");

    expect(useLocalFileStorage()).toBe(expected);
  });

  it.each([
    ["production", "local", true],
    ["test", "local", true],
    ["development", "vercel", false],
  ])("honors the backend override in NODE_ENV=%s with backend=%s", (nodeEnv, backend, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("BLOB_STORAGE_BACKEND", backend);

    expect(useLocalFileStorage()).toBe(expected);
  });

  it("rejects unsupported provider overrides", () => {
    vi.stubEnv("BLOB_STORAGE_BACKEND", "unexpected");

    expect(() => useLocalFileStorage()).toThrow("Invalid BLOB_STORAGE_BACKEND");
  });
});

describe("local file storage", () => {
  it.each([
    ["file", "application/epub+zip"],
    ["file", "application/pdf"],
    ["cover", "image/jpeg"],
    ["cover", "image/png"],
    ["cover", "image/webp"],
  ] as const)("persists %s bytes and their %s content type", async (type, contentType) => {
    const userId = createUserId();
    const bookId = "book_123-abc";
    const data = Uint8Array.of(0, 1, 2, 127, 255);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("VERCEL_BLOB_CALLBACK_URL", "");

    const result = await writeLocalFile({ userId, bookId, type, data, contentType });

    expect(result).toEqual({
      url: `/api/sync/files/download?bookId=${bookId}&type=${type}`,
    });
    expect(await readLocalFile({ userId, bookId, type })).toEqual({ data, contentType });
    expect(
      Uint8Array.from(await readFile(join(process.cwd(), "data", "blob", userId, bookId, type))),
    ).toEqual(data);
    expect(
      JSON.parse(
        await readFile(join(process.cwd(), "data", "blob", userId, bookId, `${type}.json`), "utf8"),
      ),
    ).toEqual({ contentType });
  });

  it("isolates the same book and file kind between authenticated users", async () => {
    const ownerId = createUserId();
    const otherUserId = createUserId();
    const bookId = "shared-book-id";
    const ownerData = Uint8Array.of(1, 2, 3);
    const otherUserData = Uint8Array.of(4, 5, 6);

    await writeLocalFile({
      userId: ownerId,
      bookId,
      type: "file",
      data: ownerData,
      contentType: "application/pdf",
    });

    expect(await readLocalFile({ userId: otherUserId, bookId, type: "file" })).toBeNull();

    await writeLocalFile({
      userId: otherUserId,
      bookId,
      type: "file",
      data: otherUserData,
      contentType: "application/epub+zip",
    });

    expect(await readLocalFile({ userId: ownerId, bookId, type: "file" })).toEqual({
      data: ownerData,
      contentType: "application/pdf",
    });
    expect(await readLocalFile({ userId: otherUserId, bookId, type: "file" })).toEqual({
      data: otherUserData,
      contentType: "application/epub+zip",
    });
  });

  it("keeps book files and covers separate and supports overwriting", async () => {
    const userId = createUserId();
    const bookId = "book-1";

    await Promise.all([
      writeLocalFile({
        userId,
        bookId,
        type: "file",
        data: Uint8Array.of(1),
        contentType: "application/epub+zip",
      }),
      writeLocalFile({
        userId,
        bookId,
        type: "cover",
        data: Uint8Array.of(2),
        contentType: "image/png",
      }),
    ]);
    await writeLocalFile({
      userId,
      bookId,
      type: "file",
      data: Uint8Array.of(3),
      contentType: "application/pdf",
    });

    expect(await readLocalFile({ userId, bookId, type: "file" })).toEqual({
      data: Uint8Array.of(3),
      contentType: "application/pdf",
    });
    expect(await readLocalFile({ userId, bookId, type: "cover" })).toEqual({
      data: Uint8Array.of(2),
      contentType: "image/png",
    });
  });

  it("returns null when no matching file exists", async () => {
    expect(
      await readLocalFile({ userId: createUserId(), bookId: "missing-book", type: "file" }),
    ).toBeNull();
  });

  it.each(["", ".", "..", "../escape", "nested/id", "nested\\id", "%2e%2e", "id with space"])(
    "rejects unsafe identifier %j for reads and writes",
    async (invalidId) => {
      const validId = createUserId();
      const writeInput = {
        type: "file" as const,
        data: Uint8Array.of(1),
        contentType: "application/pdf",
      };

      await expect(
        writeLocalFile({ ...writeInput, userId: invalidId, bookId: validId }),
      ).rejects.toThrow("Invalid local file storage identifier");
      await expect(
        writeLocalFile({ ...writeInput, userId: validId, bookId: invalidId }),
      ).rejects.toThrow("Invalid local file storage identifier");
      await expect(
        readLocalFile({ userId: invalidId, bookId: validId, type: "file" }),
      ).rejects.toThrow("Invalid local file storage identifier");
      await expect(
        readLocalFile({ userId: validId, bookId: invalidId, type: "file" }),
      ).rejects.toThrow("Invalid local file storage identifier");
    },
  );

  it("rejects invalid file kinds even when called from untyped runtime code", async () => {
    const userId = createUserId();
    const type = "../escape" as LocalFileKind;

    await expect(
      writeLocalFile({
        userId,
        bookId: "book-1",
        type,
        data: Uint8Array.of(1),
        contentType: "application/pdf",
      }),
    ).rejects.toThrow("Invalid local file storage type");
    await expect(readLocalFile({ userId, bookId: "book-1", type })).rejects.toThrow(
      "Invalid local file storage type",
    );
  });
});
