import type { VitePWAOptions } from "vite-plugin-pwa";
import { describe, expect, it, vi } from "vitest";

import reactRouterConfig from "../../../react-router.config";

const mocks = vi.hoisted(() => ({
  vitePWA: vi.fn((_options?: Partial<VitePWAOptions>) => []),
}));

vi.mock("@react-router/dev/vite", () => ({ reactRouter: vi.fn(() => []) }));
vi.mock("@tailwindcss/vite", () => ({ default: vi.fn(() => []) }));
vi.mock("vite-plugin-pwa", () => ({ VitePWA: mocks.vitePWA }));

await import("../../../vite.config");

function getPwaOptions() {
  const options = mocks.vitePWA.mock.calls[0]?.[0];
  if (!options?.workbox) throw new Error("VitePWA was not configured with Workbox options");
  return options.workbox;
}

function matchesRoute(
  route: NonNullable<ReturnType<typeof getPwaOptions>["runtimeCaching"]>[number],
  pathname: string,
  sameOrigin = true,
) {
  const urlPattern = route.urlPattern;
  if (typeof urlPattern !== "function") throw new Error("Route matcher is missing");
  type MatchOptions = Parameters<typeof urlPattern>[0];
  return urlPattern({
    request: { mode: "navigate" } as Request,
    url: new URL(pathname, "https://readmaxxing.test"),
    sameOrigin,
  } as MatchOptions);
}

describe("PWA document navigation", () => {
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

  it("prerenders /about", () => {
    expect(reactRouterConfig.prerender).toContain("/about");
  });
});
