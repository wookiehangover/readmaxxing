import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";

let server: ViteDevServer;
let baseURL: string;

// This integration includes the consuming app's extraction/admission bridge,
// so serve its source tree with its alias instead of the package-only demo.
test.beforeAll(async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  server = await createServer({
    configFile: false,
    root,
    resolve: { alias: { "~": `${root}/app` } },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "review-navigation-fixture",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== "/review-navigation-fixture") return next();
            response.setHeader("Content-Type", "text/html");
            response.end("<html><head></head><body></body></html>");
          });
        },
      },
    ],
  });
  await server.listen();
  baseURL = server.resolvedUrls!.local[0]!;
});

test.afterAll(async () => {
  await server?.close();
});

for (const mode of ["single", "double", "scrolled"] as const) {
  test(`extracted first-fragment whitespace admits spine starts in ${mode} while preserving later locks`, async ({
    page,
  }) => {
    await page.goto(`${baseURL}review-navigation-fixture`);
    const result = await page.evaluate(async (mode) => {
      const modulePath = "/e2e/fixtures/review-navigation.ts";
      const { exerciseSpineStart } = await import(modulePath);
      return exerciseSpineStart(mode);
    }, mode);
    expect(result.firstStart).toMatchObject({ spineIndex: 0, fragment: "first", textOffset: 0 });
    expect(result).toMatchObject({
      coldStart: true,
      bareToc: true,
      fallback: true,
      lockedSpineStart: true,
      stillSecond: true,
      continuation: true,
      reload: true,
    });
  });
}
