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

describe("PWA document navigation", () => {
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

    const urlPattern = route?.urlPattern;
    if (typeof urlPattern !== "function") throw new Error("Document route matcher is missing");
    type MatchOptions = Parameters<typeof urlPattern>[0];
    const matches = (pathname: string, sameOrigin = true) =>
      urlPattern({
        request: { mode: "navigate" } as Request,
        url: new URL(pathname, "https://readmaxxing.test"),
        sameOrigin,
      } as MatchOptions);

    expect(matches("/about")).toBe(true);
    expect(matches("/api/chat")).toBe(false);
    expect(matches("/share/book-id")).toBe(false);
    expect(matches("https://other.test/about", false)).toBe(false);
  });

  it("prerenders /about", () => {
    expect(reactRouterConfig.prerender).toContain("/about");
  });
});