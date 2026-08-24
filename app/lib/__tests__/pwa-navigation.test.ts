import type { IncomingMessage, ServerResponse } from "node:http";
import { runInNewContext } from "node:vm";
import type { Plugin, ViteDevServer } from "vite";
import type { VitePWAOptions } from "vite-plugin-pwa";
import { describe, expect, it, vi } from "vitest";

import reactRouterConfig from "../../../react-router.config";

const mocks = vi.hoisted(() => ({
  vitePWA: vi.fn((_options?: Partial<VitePWAOptions>) => []),
}));

vi.mock("@react-router/dev/vite", () => ({ reactRouter: vi.fn(() => []) }));
vi.mock("@tailwindcss/vite", () => ({ default: vi.fn(() => []) }));
vi.mock("vite-plugin-pwa", () => ({ VitePWA: mocks.vitePWA }));

const { default: viteConfig } = await import("../../../vite.config");

function getPwaOptions() {
  const options = mocks.vitePWA.mock.calls[0]?.[0];
  if (!options?.workbox) throw new Error("VitePWA was not configured with Workbox options");
  return options.workbox;
}

function matchesRoute(
  route: NonNullable<ReturnType<typeof getPwaOptions>["runtimeCaching"]>[number],
  pathname: string,
  sameOrigin = true,
  mode: RequestMode = "navigate",
) {
  const urlPattern = route.urlPattern;
  if (typeof urlPattern !== "function") throw new Error("Route matcher is missing");
  type MatchOptions = Parameters<typeof urlPattern>[0];
  return urlPattern({
    request: { mode } as Request,
    url: new URL(pathname, "https://readmaxxing.test"),
    sameOrigin,
  } as MatchOptions);
}

function matchesSerializedRoute(
  route: NonNullable<ReturnType<typeof getPwaOptions>["runtimeCaching"]>[number],
  pathname: string,
  sameOrigin = true,
  mode: RequestMode = "navigate",
) {
  const urlPattern = route.urlPattern;
  if (typeof urlPattern !== "function") throw new Error("Route matcher is missing");

  return matchesRoute(
    { ...route, urlPattern: runInNewContext(`(${urlPattern.toString()})`) as typeof urlPattern },
    pathname,
    sameOrigin,
    mode,
  );
}

describe("PWA document navigation", () => {
  it("includes all routes in the initial manifest", () => {
    expect(reactRouterConfig.routeDiscovery).toEqual({ mode: "initial" });
  });

  it("serves the canonical manifest during development without enabling its service worker", async () => {
    const manifestPlugin = viteConfig.plugins
      ?.flat()
      .find(
        (plugin): plugin is Plugin =>
          typeof plugin === "object" &&
          plugin !== null &&
          "name" in plugin &&
          plugin.name === "dev-pwa-manifest",
      );

    expect(manifestPlugin?.apply).toBe("serve");
    if (typeof manifestPlugin?.configureServer !== "function") {
      throw new Error("Development manifest middleware was not configured");
    }

    const use = vi.fn();
    const server = { middlewares: { use } } as unknown as ViteDevServer;
    await manifestPlugin.configureServer.call({} as never, server);

    const middleware = use.mock.calls[0]?.[0] as (
      request: IncomingMessage,
      response: ServerResponse,
      next: () => void,
    ) => void;
    const response = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;
    const next = vi.fn();

    middleware({ url: "/manifest.webmanifest" } as IncomingMessage, response, next);

    expect(response.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/manifest+json");
    expect(next).not.toHaveBeenCalled();

    const body = vi.mocked(response.end).mock.calls[0]?.[0];
    expect(typeof body).toBe("string");
    const manifest = JSON.parse(body as string);
    const pwaOptions = mocks.vitePWA.mock.calls[0]?.[0];

    expect(manifest).toEqual(pwaOptions?.manifest);
    expect(manifest).toMatchObject({
      name: "Readmaxxing",
      start_url: "/",
      icons: expect.arrayContaining([
        expect.objectContaining({ src: "/apple-touch-icon.png", sizes: "180x180" }),
        expect.objectContaining({ src: "/favicon.svg", type: "image/svg+xml" }),
      ]),
    });
    expect(pwaOptions?.devOptions?.enabled).toBe(false);
  });

  it("uses NetworkOnly for settings and login before the documents route", () => {
    const routes = getPwaOptions().runtimeCaching ?? [];
    const networkOnlyRoute = routes.find(
      (candidate) => candidate.handler === "NetworkOnly" && !candidate.options?.cacheName,
    );
    const documentsRoute = routes.find((candidate) => candidate.options?.cacheName === "documents");

    expect(networkOnlyRoute).toBeDefined();
    expect(documentsRoute).toBeDefined();
    expect(routes.indexOf(networkOnlyRoute!)).toBeLessThan(routes.indexOf(documentsRoute!));

    for (const pathname of ["/settings", "/settings/profile", "/login", "/login/"]) {
      expect(matchesRoute(networkOnlyRoute!, pathname)).toBe(true);
      expect(matchesRoute(documentsRoute!, pathname)).toBe(false);
    }

    expect(matchesRoute(networkOnlyRoute!, "/settings-other")).toBe(false);
    expect(matchesRoute(networkOnlyRoute!, "/about")).toBe(false);
    expect(matchesRoute(networkOnlyRoute!, "https://other.test/settings", false)).toBe(false);
  });

  it("uses the network for /about before falling back to the workspace shell", () => {
    const workbox = getPwaOptions();
    const route = workbox.runtimeCaching?.find(
      (candidate) => candidate.options?.cacheName === "documents",
    );

    expect(workbox.navigateFallback).toBeNull();
    expect(route).toMatchObject({
      handler: "NetworkFirst",
      options: {
        precacheFallback: { fallbackURL: "/index.html" },
      },
    });

    expect(matchesRoute(route!, "/about")).toBe(true);
    expect(matchesRoute(route!, "/api/chat")).toBe(false);
    expect(matchesRoute(route!, "/share/book-id")).toBe(false);
    expect(matchesRoute(route!, "/debug/reading-agent")).toBe(false);
    expect(matchesRoute(route!, "https://other.test/about", false)).toBe(false);
  });

  it("falls back reader and library data requests to an empty route response offline", async () => {
    const route = getPwaOptions().runtimeCaching?.find(
      (candidate) => candidate.options?.cacheName === "reader-route-data",
    );

    expect(route).toMatchObject({ handler: "NetworkFirst" });
    for (const pathname of ["/_.data", "/library.data", "/books/book-id.data"]) {
      expect(matchesRoute(route!, pathname, true, "cors")).toBe(true);
      expect(matchesSerializedRoute(route!, pathname, true, "cors")).toBe(true);
    }

    for (const pathname of [
      "/api/chat.data",
      "/share/book-id.data",
      "/debug/reading-agent.data",
      "/settings.data",
      "/login.data",
      "/books/book-id",
    ]) {
      expect(matchesRoute(route!, pathname, true, "cors")).toBe(false);
      expect(matchesSerializedRoute(route!, pathname, true, "cors")).toBe(false);
    }
    expect(matchesRoute(route!, "https://other.test/books/book-id.data", false, "cors")).toBe(
      false,
    );

    const fallback = await route?.options?.plugins?.[0]?.handlerDidError?.({} as never);
    expect(fallback).toBeInstanceOf(Response);
    expect(fallback?.status).toBe(204);
    expect(await fallback?.text()).toBe("");
  });

  it("keeps serialized navigation matchers independent of Vite configuration scope", () => {
    const routes = getPwaOptions().runtimeCaching ?? [];
    const networkOnlyRoute = routes.find(
      (candidate) => candidate.handler === "NetworkOnly" && !candidate.options?.cacheName,
    );
    const documentsRoute = routes.find((candidate) => candidate.options?.cacheName === "documents");

    expect(networkOnlyRoute).toBeDefined();
    expect(documentsRoute).toBeDefined();

    for (const pathname of ["/settings", "/settings/profile", "/login", "/login/"]) {
      expect(matchesSerializedRoute(networkOnlyRoute!, pathname)).toBe(true);
      expect(matchesSerializedRoute(documentsRoute!, pathname)).toBe(false);
    }

    expect(matchesSerializedRoute(networkOnlyRoute!, "/settings-other")).toBe(false);
    expect(matchesSerializedRoute(networkOnlyRoute!, "/about")).toBe(false);
    expect(matchesSerializedRoute(networkOnlyRoute!, "https://other.test/settings", false)).toBe(
      false,
    );

    expect(matchesSerializedRoute(documentsRoute!, "/about")).toBe(true);
    expect(matchesSerializedRoute(documentsRoute!, "/api/chat")).toBe(false);
    expect(matchesSerializedRoute(documentsRoute!, "/share/book-id")).toBe(false);
    expect(matchesSerializedRoute(documentsRoute!, "/debug/reading-agent")).toBe(false);
    expect(matchesSerializedRoute(documentsRoute!, "https://other.test/about", false)).toBe(false);
  });

  it("prerenders /about", () => {
    expect(reactRouterConfig.prerender).toContain("/about");
  });
});
