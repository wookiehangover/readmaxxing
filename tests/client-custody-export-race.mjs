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
        window.session = await import("/app/lib/sync/custody-session.ts");
      });
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
      return { id, claimId, unbound: new TextDecoder().decode(unbound.attachments[0].bytes) };
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
    await context.close();
  }
} finally {
  await browser?.close();
  await server?.close();
}
