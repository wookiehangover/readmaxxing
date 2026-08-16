import { describe, expect, it } from "vitest";
import type { AuthContext } from "@earendil-works/pi-ai";
import { resolveModel } from "@flue/runtime/internal";
import {
  anthropicGatewayProvider,
  type GatewayProviderId,
  gatewayAnthropicAuth,
  googleGatewayProvider,
  openaiGatewayProvider,
  toGatewayModel,
  toGatewayAnthropicModel,
  VERCEL_AI_GATEWAY_BASE_URL,
  VERCEL_AI_GATEWAY_V1_BASE_URL,
  xaiGatewayProvider,
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

  it.each([
    [
      "anthropic",
      anthropicGatewayProvider,
      "claude-sonnet-4-6",
      "anthropic/claude-sonnet-4.6",
      VERCEL_AI_GATEWAY_BASE_URL,
    ],
    ["openai", openaiGatewayProvider, "gpt-5.5", "openai/gpt-5.5", VERCEL_AI_GATEWAY_V1_BASE_URL],
    ["xai", xaiGatewayProvider, "grok-4.5", "xai/grok-4.5", VERCEL_AI_GATEWAY_V1_BASE_URL],
    [
      "google",
      googleGatewayProvider,
      "gemini-2.5-flash",
      "google/gemini-2.5-flash",
      VERCEL_AI_GATEWAY_BASE_URL,
    ],
  ] as const)(
    "registers only %s's allowlisted Gateway model",
    (providerId: GatewayProviderId, provider, modelId, gatewayModelId, baseUrl) => {
      expect(provider.getModels().map(({ id }) => id)).toEqual([modelId]);
      const model = provider.getModels()[0];
      expect(model.baseUrl).toBe(baseUrl);
      expect(toGatewayModel(providerId, model)).toMatchObject({ id: gatewayModelId, baseUrl });
      expect(resolveModel(`${providerId}/${modelId}`)).toBe(model);
    },
  );

  it("preserves the Anthropic compatibility mapping", () => {
    expect(toGatewayAnthropicModel(anthropicGatewayProvider.getModels()[0]).id).toBe(
      "anthropic/claude-sonnet-4.6",
    );
  });

  it.each([
    "anthropic/claude-opus-4-6",
    "openai/gpt-5.5-pro",
    "xai/grok-4.3",
    "google/gemini-2.5-pro",
    "unknown/model",
  ])("rejects unknown or disallowed model %s", (model) => {
    expect(() => resolveModel(model)).toThrow();
  });
});
