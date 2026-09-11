import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

test.use({ serviceWorkers: "block" });
const ownerId = "00000000-0000-4000-8000-000000000001";
const receiptId = "00000000-0000-4000-8000-000000000010";

async function seedDevice(page: Page) {
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("readmax-sync-custody-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("custody");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const partition = await new Promise<string>((resolve, reject) => {
      const tx = database.transaction("custody", "readwrite");
      const store = tx.objectStore("custody");
      const request = store.get("profile-unbound-epoch");
      request.onsuccess = () => {
        const value = request.result ?? "unbound:test-profile:epoch";
        store.put(value, "profile-unbound-epoch");
        resolve(value);
      };
      tx.onerror = () => reject(tx.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("custody", "readwrite");
      const store = tx.objectStore("custody");
      const records = [
        {
          id: "device-text",
          key: "retained-notebook",
          source: "ebook-reader-notebooks/notebooks",
          raw: { content: "Only surviving notebook text", updatedAt: NaN, optional: undefined },
        },
        {
          id: "device-file",
          key: "retained-file",
          source: "files",
          raw: new Blob([new Uint8Array([0, 1, 2, 255, 99])], { type: "application/epub+zip" }),
        },
        {
          id: "device-file-older",
          key: "retained-file",
          source: "files",
          raw: new Blob(["older distinct file"], { type: "application/epub+zip" }),
        },
      ];
      for (const record of records) {
        const { raw, ...metadata } = {
          ...record,
          kind: "snapshot",
          operationId: record.id,
          partition,
          role: "intended",
          provenance: "authored-unbound",
          createdAt: Date.now(),
        };
        store.put({ ...metadata, raw }, record.id);
        store.put(
          { ...metadata, ownership: { data: {} }, binary: raw instanceof Blob },
          `meta:${record.id}`,
        );
        store.put({}, `facts:${record.id}`);
      }
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  });
}
async function custodyIds(page: Page) {
  return page.evaluate(
    async () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("readmax-sync-custody-v1");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("custody");
          const read = tx.objectStore("custody").getAllKeys();
          tx.oncomplete = () => {
            db.close();
            resolve(read.result.filter((key) => typeof key === "string") as string[]);
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}
async function openRecovery(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Recovery", exact: true }).click();
}

test("signed-out recovery inspects invalid text, downloads exact files, and discards only a confirmed snapshot", async ({
  page,
}, testInfo) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { user: null } }));
  await openRecovery(page);
  await seedDevice(page);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const textRow = page.getByRole("listitem").filter({ hasText: "retained-notebook" });
  await textRow.getByRole("button", { name: "Inspect" }).click();
  const frame = page.frameLocator('iframe[title="Original and current content"]');
  await expect(frame.locator("body")).toContainText("Only surviving notebook text");
  await expect(frame.locator("body")).toContainText("NaN");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export original", exact: true }).click();
  const archive = unzipSync(await readFile((await (await jsonDownload).path())!));
  expect(strFromU8(archive["manifest.json"])).toContain('"value": "NaN"');
  expect(await custodyIds(page)).toContain("device-text");
  await page.getByRole("button", { name: "Discard device snapshot", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await custodyIds(page)).toContain("device-text");
  await page.getByRole("button", { name: "Discard device snapshot", exact: true }).click();
  await page.getByRole("button", { name: "Discard this snapshot", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("selected device snapshot was discarded");
  expect(await custodyIds(page)).not.toContain("device-text");
  const fileRows = page.getByRole("listitem").filter({ hasText: "retained-file" });
  await fileRows.first().getByRole("button", { name: "Inspect" }).click();
  await expect(
    page.getByRole("button", { name: "Download original file", exact: true }),
  ).toBeVisible();
  const binaryDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download original file", exact: true }).click();
  expect([...(await readFile((await (await binaryDownload).path())!))]).toEqual([0, 1, 2, 255, 99]);
  expect(await custodyIds(page)).toEqual(
    expect.arrayContaining(["device-file", "device-file-older"]),
  );
  await page.screenshot({ path: testInfo.outputPath("device-recovery.png"), fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "Recovery", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "retained-file" })).toHaveCount(2);
});

test("receipt UI handles concurrent edits, lost responses, exports, and signed-out isolation", async ({
  page,
}, testInfo) => {
  let user: { id: string; displayName: string } | null = { id: ownerId, displayName: "Reader" };
  let canonicalVersion = "reviewed-v1";
  let decisionVersion = 1;
  let state = "needs_resolution";
  let current = "Current saved text";
  let loseResponse = false;
  const submissions: string[] = [];
  const committed = new Map<string, unknown>();
  const summary = () => ({
    ownerId,
    receiptId,
    fingerprintVersion: 1,
    payloadFingerprint: "receipt-proof",
    changeId: "retired-old-queue-item",
    entity: "notebook",
    entityId: "old-book",
    sourceClock: null,
    receivedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    targetEntityId: "canonical-book",
    nextAttemptAt: null,
    attachments: [],
    state,
    reasonCode: "invalid_clock",
    decisionVersion,
  });
  const detail = () => ({
    ...summary(),
    originalSnapshot: {
      id: "retired-old-queue-item",
      entity: "notebook",
      entityId: "old-book",
      operation: "put",
      data: {
        bookId: "old-book",
        content: { type: "doc", content: [{ type: "text", text: "Retained old notebook text" }] },
      },
      timestamp: null,
    },
    originalReferences: { bookId: "old-book" },
    decisionEvidence: {},
    canonicalVersion,
    canonical: {
      entity: "notebook",
      entityId: "canonical-book",
      status: "present",
      version: canonicalVersion,
      data: {
        bookId: "canonical-book",
        content: { type: "doc", content: [{ type: "text", text: current }] },
      },
    },
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: { user } });
    if (url.pathname === "/api/auth/logout") {
      user = null;
      return route.fulfill({ json: {} });
    }
    if (url.pathname.startsWith("/api/sync/recovery")) {
      expect(request.headers()["x-recovery-owner"]).toBe(user?.id);
      if (url.pathname.endsWith("/resolve")) {
        const body = request.postDataJSON();
        submissions.push(request.postData()!);
        if (committed.has(body.resolutionId))
          return route.fulfill({ json: committed.get(body.resolutionId) });
        if (
          body.expectedDecisionVersion !== decisionVersion ||
          body.expectedCanonicalVersion !== canonicalVersion
        )
          return route.fulfill({ status: 409, json: { error: "Recovery state changed" } });
        state = "resolved";
        decisionVersion++;
        if (body.newMutation) {
          expect(body.newMutation.entityId).toBe("canonical-book");
          expect(body.newMutation.data.bookId).toBe("canonical-book");
          expect(body.newMutation.timestamp).toBeGreaterThan(Date.now() - 60_000);
          current = "Retained old notebook text";
        }
        committed.set(body.resolutionId, summary());
        if (loseResponse) {
          loseResponse = false;
          return route.abort("failed");
        }
        return route.fulfill({ json: summary() });
      }
      return route.fulfill({
        json:
          url.pathname === "/api/sync/recovery"
            ? { ownerId, receipts: [summary()], cursor: "done", hasMore: false }
            : detail(),
      });
    }
    if (url.pathname === "/api/sync/book-aliases")
      return route.fulfill({ json: { ownerId, aliases: [], cursor: "0", hasMore: false } });
    if (url.pathname === "/api/sync/push")
      return route.fulfill({ json: { accepted: [], rejected: [] } });
    if (url.pathname === "/api/sync/pull")
      return route.fulfill({ json: { changes: [], serverTimestamp: new Date().toISOString() } });
    return route.fulfill({ json: {} });
  });
  await openRecovery(page);
  await page
    .getByRole("listitem")
    .filter({ hasText: "old-book" })
    .getByRole("button", { name: "Inspect" })
    .click();
  const frame = page.frameLocator('iframe[title="Original and current content"]');
  await expect(frame.locator("body")).toContainText("Retained old notebook text");
  await expect(frame.locator("body")).toContainText("Current saved text");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export original", exact: true }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toContain(
    "Retained old notebook text",
  );
  expect(state).toBe("needs_resolution");
  canonicalVersion = "concurrent-v2";
  current = "Concurrent saved text";
  await page.getByRole("button", { name: "Use original content", exact: true }).click();
  await page.getByRole("button", { name: "Confirm use original", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/changed|review/i);
  expect(state).toBe("needs_resolution");
  expect(current).toBe("Concurrent saved text");
  await page.getByRole("button", { name: "Refresh inspection", exact: true }).click();
  await expect(frame.locator("body")).toContainText("Concurrent saved text");
  loseResponse = true;
  await page.getByRole("button", { name: "Use original content", exact: true }).click();
  await page.getByRole("button", { name: "Confirm use original", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Use original content", exact: true }).click();
  await page.getByRole("button", { name: "Confirm use original", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Decision saved");
  expect(submissions[1]).toBe(submissions[2]);
  expect(current).toBe("Retained old notebook text");
  await page.screenshot({ path: testInfo.outputPath("server-recovery.png"), fullPage: true });
  user = null;
  await page.reload();
  await page.getByRole("button", { name: "Recovery", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "old-book" })).toHaveCount(0);
});

test("file recovery reviews the canonical book and does not claim success for partial publication", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let published = false;
  let uploads = 0;
  const fileUrl = "https://test.invalid/exact-original.epub";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/session")
      return route.fulfill({ json: { user: { id: ownerId, displayName: "Reader" } } });
    if (url.pathname === "/api/sync/recovery" && url.searchParams.has("targetBookId")) {
      expect(request.headers()["x-recovery-owner"]).toBe(ownerId);
      return route.fulfill({
        json: {
          ownerId,
          canonical: {
            entity: "book",
            entityId: "canonical-file-book",
            status: "present",
            version: published ? "published-v2" : "book-v1",
            data: {
              id: "canonical-file-book",
              title: "Reviewed destination title",
              format: "epub",
              remoteFileUrl: published ? fileUrl : null,
            },
          },
        },
      });
    }
    if (url.pathname === "/api/sync/files/upload") {
      if (request.headers()["x-readmax-storage-backend"] === "negotiate")
        return route.fulfill({ json: { backend: "local" } });
      expect(url.searchParams.get("bookId")).toBe("canonical-file-book");
      expect(request.headers()["x-recovery-owner"]).toBe(ownerId);
      expect(request.headers()["x-recovery-version"]).toBe("book-v1");
      expect([...request.postDataBuffer()!]).toEqual([0, 1, 2, 255, 99]);
      uploads++;
      return route.fulfill({ json: { url: fileUrl } });
    }
    if (url.pathname === "/api/sync/recovery")
      return route.fulfill({ json: { ownerId, receipts: [], cursor: "done", hasMore: false } });
    if (url.pathname === "/api/sync/book-aliases")
      return route.fulfill({ json: { ownerId, aliases: [], cursor: "0", hasMore: false } });
    if (url.pathname === "/api/sync/pull")
      return route.fulfill({ json: { changes: [], serverTimestamp: new Date().toISOString() } });
    if (url.pathname === "/api/sync/push")
      return route.fulfill({ json: { accepted: [], rejected: [] } });
    return route.fulfill({ json: {} });
  });
  await openRecovery(page);
  await seedDevice(page);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "retained-file" })
    .first()
    .getByRole("button", { name: "Inspect" })
    .click();
  await page.getByRole("button", { name: "Review file destination", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Original and current content"]').locator("body"),
  ).toContainText("Reviewed destination title");
  await page.getByRole("button", { name: "Upload original book file", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(uploads).toBe(0);
  await page.getByRole("button", { name: "Upload original book file", exact: true }).click();
  await page.getByRole("button", { name: "Confirm file upload", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not yet published");
  expect(await custodyIds(page)).toEqual(
    expect.arrayContaining(["device-file", "device-file-older"]),
  );
  expect(uploads).toBe(1);
  published = true;
  await page.getByRole("button", { name: "Upload original book file", exact: true }).click();
  await page.getByRole("button", { name: "Confirm file upload", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("selected file is published");
  expect(uploads).toBe(1);
  expect(await custodyIds(page)).toEqual(
    expect.arrayContaining(["device-file", "device-file-older"]),
  );
});

test("local text enters review before any explicit account edit and keeps its invalid-clock original", async ({
  page,
}) => {
  let admissions = 0;
  let resolutions = 0;
  let snapshot: Record<string, unknown> = {};
  const summary = () => ({
    ownerId,
    receiptId,
    entity: "notebook",
    entityId: "retained-notebook",
    changeId: "local:device-text",
    state: "needs_resolution",
    reasonCode: "local_recovery",
    decisionVersion: 1,
    receivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachments: [],
    fingerprintVersion: 1,
    payloadFingerprint: "local-proof",
    sourceClock: null,
    targetEntityId: "retained-notebook",
    nextAttemptAt: null,
  });
  const detail = () => ({
    ...summary(),
    originalSnapshot: snapshot,
    originalReferences: {},
    decisionEvidence: {},
    canonicalVersion: "review-v1",
    canonical: {
      entity: "notebook",
      entityId: "retained-notebook",
      status: "present",
      version: "review-v1",
      data: { bookId: "retained-notebook", content: "Current server notebook" },
    },
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/session")
      return route.fulfill({ json: { user: { id: ownerId, displayName: "Reader" } } });
    if (url.pathname === "/api/sync/recovery" && request.method() === "POST") {
      expect(request.headers()["x-recovery-owner"]).toBe(ownerId);
      snapshot = request.postDataJSON().snapshot;
      admissions++;
      expect(snapshot.recoveryProjection).toBeDefined();
      return route.fulfill({ json: detail() });
    }
    if (url.pathname.endsWith("/resolve")) {
      resolutions++;
      expect(request.postDataJSON().expectedCanonicalVersion).toBe("review-v1");
      return route.fulfill({ status: 409, json: { error: "Recovery state changed" } });
    }
    if (url.pathname === "/api/sync/recovery")
      return route.fulfill({
        json: { ownerId, receipts: admissions ? [summary()] : [], cursor: "done", hasMore: false },
      });
    if (url.pathname === "/api/sync/book-aliases")
      return route.fulfill({ json: { ownerId, aliases: [], cursor: "0", hasMore: false } });
    if (url.pathname === "/api/sync/pull")
      return route.fulfill({ json: { changes: [], serverTimestamp: new Date().toISOString() } });
    if (url.pathname === "/api/sync/push")
      return route.fulfill({ json: { accepted: [], rejected: [] } });
    return route.fulfill({ json: {} });
  });
  await openRecovery(page);
  await seedDevice(page);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "retained-notebook" })
    .getByRole("button", { name: "Inspect" })
    .click();
  await page.getByRole("button", { name: "Review content with account", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(admissions).toBe(0);
  await page.getByRole("button", { name: "Review content with account", exact: true }).click();
  await page.getByRole("button", { name: "Send for review", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Original and current content"]').locator("body"),
  ).toContainText("Current server notebook");
  expect(admissions).toBe(1);
  expect(resolutions).toBe(0);
  await page.getByRole("button", { name: "Use original content", exact: true }).click();
  await page.getByRole("button", { name: "Confirm use original", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed");
  expect(resolutions).toBe(1);
  expect(await custodyIds(page)).toContain("device-text");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export original", exact: true }).click();
  const archive = unzipSync(await readFile((await (await download).path())!));
  expect(strFromU8(archive["manifest.json"])).toContain('"value": "NaN"');
});
