// @vitest-environment node
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { writeLocalFile, readLocalFile } from "../local-file-storage.server";

it("stages a selected revision without overwriting existing bytes and retains both revisions", async () => {
  const userId = `recovery-storage-test-${randomUUID()}`;
  const location = { userId, bookId: "book", type: "file" as const };
  try {
    await writeLocalFile({
      ...location,
      data: new Uint8Array([1]),
      contentType: "application/pdf",
    });
    const result = await writeLocalFile({
      ...location,
      revision: "selected-revision",
      data: new Uint8Array([2]),
      contentType: "application/epub+zip",
    });
    expect(result.url).toContain("&revision=selected-revision");
    expect((await readLocalFile(location))!.data).toEqual(new Uint8Array([1]));
    expect(await readLocalFile({ ...location, revision: "selected-revision" })).toEqual({
      data: new Uint8Array([2]),
      contentType: "application/epub+zip",
    });
    await expect(
      writeLocalFile({
        ...location,
        revision: "selected-revision",
        data: new Uint8Array([3]),
        contentType: "application/pdf",
      }),
    ).rejects.toThrow();
    expect((await readLocalFile({ ...location, revision: "selected-revision" }))!.data).toEqual(
      new Uint8Array([2]),
    );
    await expect(readLocalFile({ ...location, revision: "../file" })).rejects.toThrow(
      "Invalid file revision",
    );
  } finally {
    await rm(join(process.cwd(), "data", "blob", userId), { recursive: true, force: true });
  }
});
