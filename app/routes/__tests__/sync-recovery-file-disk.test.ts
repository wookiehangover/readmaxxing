// @vitest-environment node
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { USER, mutation, push } from "~/lib/sync/__tests__/integration/push-route-harness";
import { getRecoveryBook } from "~/lib/database/sync-delivery/recovery-book";
import { writeLocalFile } from "~/lib/storage/local-file-storage.server";
import { action as upload } from "../api.sync.files.upload";
import { loader as download } from "../api.sync.files.download";

it.each(["file", "cover"] as const)(
  "downloads the committed selected %s revision from real disk",
  async (type) => {
    vi.stubEnv("BLOB_STORAGE_BACKEND", "local");
    const bookId = `recovery-disk-${randomUUID()}`;
    try {
      await push([{ ...mutation("book"), entityId: bookId, data: { title: "disk test" } }]);
      const target = await getRecoveryBook(USER, bookId);
      const response = await upload({
        request: new Request(`https://test/api/sync/files/upload?bookId=${bookId}&type=${type}`, {
          method: "POST",
          headers: {
            "X-Recovery-Owner": USER,
            "X-Recovery-Version": target.canonical.version,
            "Content-Type": type === "file" ? "application/pdf" : "image/png",
          },
          body: new Uint8Array([2, 3, 4]),
        }),
      });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.url).toContain("&revision=");
      await writeLocalFile({
        userId: USER,
        bookId,
        type,
        data: new Uint8Array([9]),
        contentType: "application/pdf",
      });
      const read = await download({ request: new Request(new URL(result.url, "https://test")) });
      expect(read.status).toBe(200);
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4]));
    } finally {
      await rm(join(process.cwd(), "data", "blob", USER, bookId), { recursive: true, force: true });
    }
  },
);
