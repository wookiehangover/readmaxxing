import { describe, expect, it } from "vitest";
import {
  createReadingAgentHost,
  shouldUseVercelReadingAgentHost,
  stopReadingAgentHost,
} from "../agent-host.server";

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

  it("does not resume a host that is absent from this app process", async () => {
    await expect(stopReadingAgentHost("orphan-conversation")).resolves.toBe(false);
  });

  it("reuses the active host for the same conversation", async () => {
    const conversationId = "reused-conversation";
    const [first, second] = await Promise.all([
      createReadingAgentHost(conversationId, "test-secret", { NODE_ENV: "test" }),
      createReadingAgentHost(conversationId, "test-secret", { NODE_ENV: "test" }),
    ]);
    try {
      expect(second).toBe(first);
    } finally {
      await first.dispose();
    }
  });
});
