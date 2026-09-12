// @vitest-environment node
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { clear, get } from "idb-keyval";
import { USER, OTHER_USER, db, mutation, push } from "./push-route-harness";
import { loader as targetLoader } from "~/routes/api.sync.recovery";
import {
  validateRecoveryUpload,
  publishRecoveryUpload,
} from "~/lib/database/sync-delivery/recovery-upload";
let getRecoveryBookTarget: typeof import("../../local-recovery-files").getRecoveryBookTarget;
let prepareLocalFileRecovery: typeof import("../../local-recovery-files").prepareLocalFileRecovery;
let submitLocalFileRecovery: typeof import("../../local-recovery-files").submitLocalFileRecovery;
import { retainCustody, factsKey } from "../../custody-journal";
import { localRecoveryDetail } from "../../custody-export";
import { setCustodyAccount } from "../../custody-session";
import { getCustodyStore, getBookRemapStore } from "../../stores";
import type { RecoveryUploadGuard } from "../../delivery-types";

const sdk = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@vercel/blob/client", () => ({ upload: sdk.upload }));
beforeAll(async () => {
  // The SQL push harness suppresses ordinary uploads. This test loads the real
  // upload owner for the explicit recovery path after that harness is ready.
  vi.doMock("../../file-uploads", async () => vi.importActual("../../file-uploads"));
  ({ getRecoveryBookTarget, prepareLocalFileRecovery, submitLocalFileRecovery } =
    await import("../../local-recovery-files"));
});
let uploaded: Blob | undefined;
let publish = true;
beforeEach(async () => {
  setCustodyAccount(USER);
  await Promise.all([getCustodyStore(), getBookRemapStore()].map((store) => clear(store)));
  uploaded = undefined;
  publish = true;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) =>
    targetLoader({ request: new Request(`https://test${url}`, init) }),
  );
  sdk.upload.mockImplementation(
    async (
      _path: string,
      blob: Blob,
      options: { clientPayload: string; headers: Record<string, string> },
    ) => {
      const { bookId, type, recovery } = JSON.parse(options.clientPayload) as {
        bookId: string;
        type: "file" | "cover";
        recovery: RecoveryUploadGuard;
      };
      expect(options.headers["X-Recovery-Owner"]).toBe(USER);
      await validateRecoveryUpload(USER, bookId, recovery);
      uploaded = blob;
      const url = `https://blob.test/recovered-${type}-${crypto.randomUUID()}`;
      if (publish) await publishRecoveryUpload(USER, bookId, type, url, recovery);
      return { url };
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
async function prepare(type: "file" | "cover" = "file") {
  await push([mutation("book")]);
  const bytes = new Uint8Array([0, 255, 3, 4, 42]);
  const id = await retainCustody({
    source: "files",
    key: "entity",
    raw: new Blob([bytes], { type: type === "file" ? "application/epub+zip" : "image/png" }),
    role: "intended",
    ownerId: USER,
  });
  const source = await localRecoveryDetail(id, USER);
  const target = await getRecoveryBookTarget(USER, "entity");
  const submissionId = await prepareLocalFileRecovery({
    ownerId: USER,
    id,
    expectedVersion: source.version,
    targetBookId: target.canonical.entityId!,
    expectedCanonicalVersion: target.canonical.version,
    type,
  });
  return { id, submissionId, bytes };
}
it.each(["file", "cover"] as const)(
  "publishes exact selected %s bytes to the real owned canonical target, keeping raw",
  async (type) => {
    const { id, submissionId, bytes } = await prepare(type);
    const result = await submitLocalFileRecovery({ ownerId: USER, submissionId });
    expect(new Uint8Array(await uploaded!.arrayBuffer())).toEqual(bytes);
    const column = type === "file" ? "file_blob_url" : "cover_blob_url";
    expect(
      (await db.query(`SELECT ${column} AS url FROM readmax.book WHERE id='entity'`)).rows[0],
    ).toEqual({
      url: result.canonical.data![type === "file" ? "remoteFileUrl" : "remoteCoverUrl"],
    });
    expect(await get(id, getCustodyStore())).toBeDefined();
    expect(await get(factsKey(id), getCustodyStore())).not.toHaveProperty("retired", true);
    expect((await db.query("SELECT * FROM readmax.sync_recovery_admission")).rows).toEqual([]);
  },
);
it("a changed canonical version rejects attachment without sending bytes or losing raw", async () => {
  const { id, submissionId } = await prepare();
  await db.query("UPDATE readmax.book SET title='changed' WHERE id='entity'");
  await expect(submitLocalFileRecovery({ ownerId: USER, submissionId })).rejects.toThrow(
    /target changed/,
  );
  expect(uploaded).toBeUndefined();
  expect(await get(id, getCustodyStore())).toBeDefined();
});
it("does not report blob completion as successful publication", async () => {
  const { id, submissionId } = await prepare();
  publish = false;
  await expect(submitLocalFileRecovery({ ownerId: USER, submissionId })).rejects.toThrow(
    /not yet published/,
  );
  expect(uploaded).toBeDefined();
  expect(await get(id, getCustodyStore())).toBeDefined();
  const url = await get<string>(["file-recovery-url", submissionId], getCustodyStore());
  await db.query("UPDATE readmax.book SET file_blob_url=$1 WHERE id='entity'", [url]);
  expect(
    (await submitLocalFileRecovery({ ownerId: USER, submissionId })).canonical.data!.remoteFileUrl,
  ).toBe(url);
});
it("rejects switched account without exposing selected bytes", async () => {
  const { id, submissionId } = await prepare();
  setCustodyAccount(OTHER_USER);
  await expect(submitLocalFileRecovery({ ownerId: OTHER_USER, submissionId })).rejects.toThrow();
  expect(uploaded).toBeUndefined();
  expect(await get(id, getCustodyStore())).toBeDefined();
});

it("offers only the byte kind backed by the selected local snapshot", async () => {
  const { localRecoveryCapabilities, localRecoveryFile } =
    await import("../../local-recovery-source");
  for (const [raw, kinds] of [
    [new Blob(["image"], { type: "image/png" }), ["cover"]],
    [new Blob(["book"], { type: "application/pdf" }), ["file"]],
    [new Uint8Array([1, 2]).buffer, ["file"]],
    [{ fileData: new Uint8Array([1]).buffer, coverBlob: new Blob(["cover"]) }, ["file", "cover"]],
  ] as const) {
    const id = await retainCustody({
      source: "files",
      key: "entity",
      raw,
      role: "intended",
      ownerId: USER,
    });
    const { item } = await localRecoveryDetail(id, USER);
    expect((await localRecoveryCapabilities(item)).files).toEqual(kinds);
    for (const kind of ["file", "cover"] as const)
      if (!(kinds as readonly string[]).includes(kind))
        expect(() => localRecoveryFile(item, kind)).toThrow();
  }
});
