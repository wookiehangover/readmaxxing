import { describe, expect, it } from "vitest";
import type { AuthContext } from "@earendil-works/pi-ai";
import {
  anthropicGatewayProvider,
  gatewayAnthropicAuth,
  toGatewayAnthropicModel,
  VERCEL_AI_GATEWAY_BASE_URL,
} from "./vercel-ai-gateway";

function authContext(env: Record<string, string | undefined>): AuthContext {
  return {
    env: async (name) => env[name],
    fileExists: async () => false,
  };
}

describe("Vercel AI Gateway provider", () => {
  it("prefers AI_GATEWAY_API_KEY over VERCEL_OIDC_TOKEN", async () => {
    const result = await gatewayAnthropicAuth.resolve({
      ctx: authContext({ AI_GATEWAY_API_KEY: "gateway", VERCEL_OIDC_TOKEN: "oidc" }),
    });

    expect(result).toEqual({
      auth: { headers: { Authorization: "Bearer gateway" } },
      source: "AI_GATEWAY_API_KEY",
    });
  });

  it("falls back to VERCEL_OIDC_TOKEN and otherwise stays unauthenticated", async () => {
    await expect(
      gatewayAnthropicAuth.resolve({
        ctx: authContext({ VERCEL_OIDC_TOKEN: "oidc" }),
      }),
    ).resolves.toEqual({
      auth: { headers: { Authorization: "Bearer oidc" } },
      source: "VERCEL_OIDC_TOKEN",
    });
    await expect(gatewayAnthropicAuth.resolve({ ctx: authContext({}) })).resolves.toBeUndefined();
  });

  it("registers Anthropic's catalog and maps ReadingScribe's model for Gateway", () => {
    expect(anthropicGatewayProvider.id).toBe("anthropic");
    const model = anthropicGatewayProvider.getModels().find(({ id }) => id === "claude-sonnet-4-6");
    expect(model?.baseUrl).toBe(VERCEL_AI_GATEWAY_BASE_URL);
    expect(model && toGatewayAnthropicModel(model).id).toBe("anthropic/claude-sonnet-4.6");
  });
});
