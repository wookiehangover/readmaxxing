import { describe, expect, it } from "vitest";
import { shouldUseVercelReadingAgentHost } from "../agent-host.server";

describe("ReadingScribe app host selection", () => {
  it("uses the in-process host during local development", () => {
    expect(
      shouldUseVercelReadingAgentHost({
        NODE_ENV: "development",
        VERCEL_OIDC_TOKEN: "available",
      }),
    ).toBe(false);
  });

  it("uses the in-process memory host in production without Vercel credentials", () => {
    expect(shouldUseVercelReadingAgentHost({ NODE_ENV: "production" })).toBe(false);
  });

  it("uses a Vercel Sandbox in production when credentials are available", () => {
    expect(
      shouldUseVercelReadingAgentHost({
        NODE_ENV: "production",
        VERCEL_TOKEN: "available",
        VERCEL_PROJECT_ID: "project",
        VERCEL_TEAM_ID: "team",
      }),
    ).toBe(true);
  });
});
