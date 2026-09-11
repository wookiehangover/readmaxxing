// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import {
  USER,
  OTHER_USER,
  db,
  mutation,
  push,
  mocks,
} from "~/lib/sync/__tests__/integration/push-route-harness";
import { getRecoveryBook } from "~/lib/database/sync-delivery/recovery-book";
import type { RecoveryUploadGuard } from "~/lib/sync/delivery-types";

const storage = vi.hoisted(() => ({ local: true, write: vi.fn(), handle: vi.fn() }));
vi.mock("~/lib/storage/local-file-storage.server", () => ({
  useLocalFileStorage: () => storage.local,
  writeLocalFile: storage.write,
}));
vi.mock("@vercel/blob/client", () => ({ handleUpload: storage.handle }));
import { action } from "../api.sync.files.upload";

beforeEach(() => {
  storage.local = true;
  storage.write.mockReset().mockImplementation(async ({ revision }: { revision?: string }) => ({
    url: `https://blob.test/${revision ?? "overwritten"}`,
  }));
  storage.handle.mockReset().mockImplementation(async (options) => {
    if (options.body.phase === "token")
      return options.onBeforeGenerateToken(
        options.body.pathname,
        JSON.stringify(options.body.payload),
      );
    await options.onUploadCompleted(options.body);
    return { response: "ok" };
  });
});
async function seed() {
  await push([mutation("book")]);
  return {
    ownerId: USER,
    expectedCanonicalVersion: (await getRecoveryBook(USER, "entity")).canonical.version,
  };
}
function local(guard: RecoveryUploadGuard, type = "file", bookId = "entity") {
  return action({
    request: new Request(`https://test/api/sync/files/upload?bookId=${bookId}&type=${type}`, {
      method: "POST",
      headers: {
        "Content-Type": type === "file" ? "application/pdf" : "image/png",
        "X-Recovery-Owner": guard.ownerId,
        "X-Recovery-Version": guard.expectedCanonicalVersion,
      },
      body: new Uint8Array([4, 3, 2, 1]),
    }),
  });
}
function vercel(body: unknown) {
  storage.local = false;
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "fake-test-token");
  return action({
    request: new Request("https://test/api/sync/files/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}
const currentUrl = async (type = "file") =>
  (
    await db.query<Record<string, string>>(
      `SELECT ${type}_blob_url FROM readmax.book WHERE id='entity'`,
    )
  ).rows[0][`${type}_blob_url`];

it.each(["file", "cover"])(
  "publishes the selected %s through a unique staged revision and version fence",
  async (type) => {
    const guard = await seed();
    const response = await local(guard, type);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(storage.write).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: expect.any(String),
        data: new Uint8Array([4, 3, 2, 1]),
        type,
      }),
    );
    expect(await currentUrl(type)).toBe(body.url);
    expect((await getRecoveryBook(USER, "entity")).canonical.version).not.toBe(
      guard.expectedCanonicalVersion,
    );
    expect((await db.query("SELECT * FROM readmax.sync_recovery_admission")).rows).toEqual([]);
  },
);

it("rejects stale owner before SQL or bytes, and stale canonical version before staging", async () => {
  const guard = await seed();
  const count = mocks.query.mock.calls.length;
  expect((await local({ ...guard, ownerId: OTHER_USER })).status).toBe(409);
  expect(mocks.query).toHaveBeenCalledTimes(count);
  expect(storage.write).not.toHaveBeenCalled();
  await db.query("UPDATE readmax.book SET title='newer' WHERE id='entity'");
  expect((await local(guard)).status).toBe(409);
  expect(storage.write).not.toHaveBeenCalled();
  expect(await currentUrl()).toBe("https://blob.test/0.epub");
});

it("preserves newer pointer when the target changes while local bytes are staged", async () => {
  const guard = await seed();
  storage.write.mockImplementation(async ({ revision }) => {
    expect(revision).toBeTypeOf("string");
    await db.query(
      "UPDATE readmax.book SET file_blob_url='https://blob.test/newer' WHERE id='entity'",
    );
    return { url: `https://blob.test/staged-${revision}` };
  });
  expect((await local(guard)).status).toBe(409);
  expect(await currentUrl()).toBe("https://blob.test/newer");
});

it.each(["deleted", "alias", "missing"])(
  "refuses %s target without staging bytes",
  async (state) => {
    const guard = await seed();
    if (state === "deleted")
      await db.query("UPDATE readmax.book SET deleted_at=now() WHERE id='entity'");
    if (state === "alias") {
      await db.query("INSERT INTO readmax.book(id,user_id) VALUES('canonical',$1)", [USER]);
      await db.query("UPDATE readmax.book SET canonical_id='canonical' WHERE id='entity'");
    }
    expect((await local(guard, "file", state === "missing" ? "missing" : "entity")).status).toBe(
      404,
    );
    expect(storage.write).not.toHaveBeenCalled();
  },
);

it("failed pointer storage does not publish staged bytes", async () => {
  const guard = await seed();
  const execute = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((query) => {
    if (typeof query !== "string" && query.text.includes("SET file_blob_url = COALESCE"))
      throw new Error("database unavailable");
    return execute(query);
  });
  expect((await local(guard)).status).toBe(400);
  expect(storage.write).toHaveBeenCalledWith(
    expect.objectContaining({ revision: expect.any(String) }),
  );
  expect(await currentUrl()).toBe("https://blob.test/0.epub");
});

it("signs unique non-overwriting Vercel recovery tokens and rechecks version at callback publication", async () => {
  const recovery = await seed();
  const issue = () =>
    vercel({
      phase: "token",
      pathname: `books/${USER}/entity/selected.pdf`,
      payload: { bookId: "entity", type: "file", recovery },
    });
  const response = await issue();
  expect(response.status).toBe(200);
  const token = await response.json();
  expect(token).toMatchObject({ addRandomSuffix: true, allowOverwrite: false });
  expect(JSON.parse(token.tokenPayload)).toMatchObject({ userId: USER, recovery });
  await db.query("UPDATE readmax.book SET title='newer' WHERE id='entity'");
  expect(
    (await vercel({ blob: { url: "https://blob.test/staged" }, tokenPayload: token.tokenPayload }))
      .status,
  ).toBe(409);
  expect(await currentUrl()).toBe("https://blob.test/0.epub");
  expect((await issue()).status).toBe(409);
});

it("publishes a Vercel callback only to its reviewed account-owned live target", async () => {
  const recovery = await seed();
  const tokenPayload = JSON.stringify({ userId: USER, bookId: "entity", type: "file", recovery });
  expect((await vercel({ blob: { url: "https://blob.test/selected" }, tokenPayload })).status).toBe(
    200,
  );
  expect(await currentUrl()).toBe("https://blob.test/selected");
  expect(
    (
      await vercel({
        blob: { url: "https://blob.test/foreign" },
        tokenPayload: JSON.stringify({
          userId: USER,
          bookId: "entity",
          type: "file",
          recovery: { ...recovery, ownerId: OTHER_USER },
        }),
      })
    ).status,
  ).toBe(409);
  expect(await currentUrl()).toBe("https://blob.test/selected");
});
