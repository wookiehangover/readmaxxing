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
    esbuild: { jsx: "automatic" },
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

test("review ownership survives live switches and parent Store teardown", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: "{}",
    }),
  );
  await page.goto(`${baseURL}review-navigation-fixture`);
  const result = await page.evaluate(async () => {
    const modulePath = "/e2e/fixtures/review-navigation-lifecycle.tsx";
    const { exerciseReviewTeardown } = await import(modulePath);
    return exerciseReviewTeardown();
  });
  expect(result).toEqual({ opened: true, switched: true, closed: true, newerOwnerRetained: true });
  expect(errors).toEqual([]);
});

for (const mode of ["single", "double", "scrolled"] as const) {
  for (const method of ["buttons", "gesture"] as const) {
    test(`locked continuation returns to its prior fragment endpoint in ${mode} using ${method}`, async ({
      page,
    }) => {
      await page.route("**/api/reviews/**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Offline fixture" }),
        }),
      );
      await page.goto(`${baseURL}review-navigation-fixture`);
      const result = await page.evaluate(
        async ({ mode, method }) => {
          const modulePath = "/e2e/fixtures/review-navigation.ts";
          const { exerciseContinuation } = await import(modulePath);
          return exerciseContinuation(mode, method);
        },
        { mode, method },
      );
      expect(result.atPriorEnd, JSON.stringify(result.endGeometry)).toBe(true);
      expect(result).toMatchObject({
        forward: true,
        backSpine: 0,
        sameChapter: true,
        atPriorEnd: true,
        firstHidden: true,
        locked: true,
        earlierBlocked: true,
      });
    });
  }
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
