import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Run standalone, or provide an existing local Vite source server URL.
const externalOrigin = process.argv[2];
const server = externalOrigin
  ? undefined
  : await createServer({
      configFile: false,
      root: fileURLToPath(new URL("../", import.meta.url)),
      resolve: { tsconfigPaths: true },
      optimizeDeps: { include: ["idb-keyval", "ulid"] },
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "custody-browser-probe",
          configureServer(server) {
            server.middlewares.use((request, response, next) => {
              if (request.url !== "/") return next();
              response.setHeader("Content-Type", "text/html");
              response.end("<html><body>Local custody test</body></html>");
            });
          },
        },
      ],
    });
let browser;
try {
  if (server) await server.listen();
  const origin = externalOrigin ?? server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  for (const binding of ["item", "group", "resource"]) {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    for (const page of [a, b]) {
      await page.goto(origin);
      await page.evaluate(async () => {
        window.journal = await import("/app/lib/sync/custody-journal.ts");
        window.recovery = await import("/app/lib/sync/custody-export.ts");
        window.discard = await import("/app/lib/sync/custody-discard.ts");
        window.session = await import("/app/lib/sync/custody-session.ts");
      });
    }
    if (binding === "item") {
      const removed = await a.evaluate(async () => {
        const id = await window.journal.retainCustody({
          source: "files",
          key: "signed-out-discard",
          raw: new Blob(["explicit local discard"]),
          role: "intended",
        });
        const { version } = await window.recovery.localRecoveryDetail(id);
        await window.discard.discardLocalRecovery({ id, expectedVersion: version });
        return !(await window.recovery.localRecoverySummaries()).some((item) => item.id === id);
      });
      assert.equal(removed, true);
      console.log("PASS signed-out exact Blob discard");
    }
    const ids = await a.evaluate(async (binding) => {
      const id = await window.journal.retainCustody({
        source: "files",
        key: "export-race",
        operationId: "original",
        raw: new Blob(["account-bound unique bytes"]),
        role: "intended",
      });
      const claimId =
        binding === "item"
          ? id
          : await window.journal.retainCustody({
              source: "files",
              key: binding === "group" ? "other-file" : "export-race",
              operationId: binding === "group" ? "original" : "different",
              raw: new Blob(["sibling revision"]),
              role: "intended",
            });
      const unbound = await window.recovery.exportLocalRecovery(id);
      const { version } = await window.recovery.localRecoveryDetail(id);
      return {
        id,
        claimId,
        version,
        unbound: new TextDecoder().decode(unbound.attachments[0].bytes),
      };
    }, binding);
    assert.equal(ids.unbound, "account-bound unique bytes");
    await a.evaluate(() => window.session.setCustodyAccount("A"));
    await b.evaluate(() => window.session.setCustodyAccount("B"));
    await b.evaluate((id) => {
      const original = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = async function () {
        window.exportPaused = true;
        await new Promise((resolve) => {
          window.releaseExport = resolve;
        });
        return original.call(this);
      };
      window.pendingExport = window.recovery
        .exportLocalRecovery(id, "B")
        .then(
          (value) => {
            window.exportResult = value;
          },
          (error) => {
            window.exportError = String(error);
          },
        )
        .finally(() => {
          Blob.prototype.arrayBuffer = original;
          window.exportDone = true;
        });
    }, ids.id);
    await b.waitForFunction(() => window.exportPaused);
    assert.equal(await a.evaluate((id) => window.journal.bindCustody(id, "A"), ids.claimId), true);
    await b.evaluate(() => window.releaseExport());
    await b.waitForFunction(() => window.exportDone);
    const rejected = await b.evaluate(() => ({
      error: window.exportError,
      published: window.exportResult !== undefined,
    }));
    assert.match(rejected.error, /unavailable/);
    assert.equal(rejected.published, false);
    const retained = await a.evaluate(async (id) => {
      const detail = await window.recovery.localRecoveryDetail(id, "A");
      const exported = await window.recovery.exportLocalRecovery(id, "A");
      return {
        raw: await detail.item.raw.text(),
        bytes: new TextDecoder().decode(exported.attachments[0].bytes),
      };
    }, ids.id);
    assert.deepEqual(retained, {
      raw: "account-bound unique bytes",
      bytes: "account-bound unique bytes",
    });
    console.log(
      `PASS ${binding} binding race: losing export rejected, same-owner raw/detail/export intact`,
    );
    const rejectedDiscard = await b.evaluate(async ({ id, version }) => {
      try {
        await window.discard.discardLocalRecovery({ id, expectedVersion: version, ownerId: "B" });
        return false;
      } catch {
        return true;
      }
    }, ids);
    assert.equal(rejectedDiscard, true);
    const discarded = await a.evaluate(async (id) => {
      const { version } = await window.recovery.localRecoveryDetail(id, "A");
      await window.discard.discardLocalRecovery({ id, expectedVersion: version, ownerId: "A" });
      return !(await window.recovery.localRecoverySummaries("A")).some((item) => item.id === id);
    }, ids.id);
    assert.equal(discarded, true);
    console.log(
      `PASS ${binding} discard: stale foreign review rejected, exact owner Blob snapshot removed`,
    );
    await context.close();
  }
  for (const switchAccount of [false, true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin);
    let remoteFileUrl = null;
    const uploaded = [];
    await page.route("**/api/sync/recovery?targetBookId=*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ownerId: "A",
          canonical: {
            entity: "book",
            entityId: "entity",
            status: "present",
            version: remoteFileUrl ? "published" : "reviewed",
            data: { id: "entity", format: "epub", remoteFileUrl },
          },
        }),
      }),
    );
    await page.route("**/api/sync/files/upload?*", async (route) => {
      const request = route.request();
      assert.equal(request.headers()["x-recovery-owner"], "A");
      assert.equal(request.headers()["x-recovery-version"], "reviewed");
      uploaded.push([...request.postDataBuffer()]);
      remoteFileUrl = "https://blob.test/selected-revision";
      if (switchAccount) await page.evaluate(() => window.session.setCustodyAccount("B"));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ url: remoteFileUrl }),
      });
    });
    const result = await page.evaluate(async () => {
      const journal = await import("/app/lib/sync/custody-journal.ts");
      const recovery = await import("/app/lib/sync/custody-export.ts");
      const files = await import("/app/lib/sync/local-recovery-files.ts");
      window.session = await import("/app/lib/sync/custody-session.ts");
      window.session.setCustodyAccount("A");
      const bytes = new Uint8Array([99, 8, 0, 255, 77]);
      const id = await journal.retainCustody({
        source: "files",
        key: "entity",
        raw: bytes.subarray(1, 4),
        role: "intended",
        ownerId: "A",
      });
      const { version } = await recovery.localRecoveryDetail(id, "A");
      const target = await files.getRecoveryBookTarget("A", "entity");
      const submissionId = await files.prepareLocalFileRecovery({
        ownerId: "A",
        id,
        expectedVersion: version,
        targetBookId: "entity",
        expectedCanonicalVersion: target.canonical.version,
        type: "file",
      });
      let success = false,
        error;
      try {
        await files.submitLocalFileRecovery({ ownerId: "A", submissionId });
        success = true;
      } catch (cause) {
        error = String(cause);
      }
      const { getCustodyStore } = await import("/app/lib/sync/stores.ts");
      const present = await getCustodyStore()(
        "readonly",
        (store) =>
          new Promise((resolve) => {
            const request = store.count(id);
            request.onsuccess = () => resolve(request.result);
          }),
      );
      return { success, error, present };
    });
    assert.deepEqual(uploaded, [[8, 0, 255]]);
    assert.equal(result.present, 1);
    assert.equal(result.success, !switchAccount);
    if (switchAccount) assert.match(result.error, /Account changed/);
    console.log(
      `PASS selected native file bytes and ${switchAccount ? "account-switch rejection" : "publication confirmation"}`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  await server?.close();
}
