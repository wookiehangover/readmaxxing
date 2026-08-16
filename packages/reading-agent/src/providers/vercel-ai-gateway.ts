import { setProvider } from "@flue/runtime";
import {
  createProvider,
  type Api,
  type ApiKeyAuth,
  type Model,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";

export const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

const GATEWAY_MODEL_IDS = {
  anthropic: { "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6" },
  openai: { "gpt-5.5": "openai/gpt-5.5" },
  xai: { "grok-4.5": "xai/grok-4.5" },
  google: { "gemini-2.5-flash": "google/gemini-2.5-flash" },
} as const;

export type GatewayProviderId = keyof typeof GATEWAY_MODEL_IDS;

export const gatewayAuth: ApiKeyAuth = {
  name: "Vercel AI Gateway credential",
  async resolve({ ctx }) {
    for (const source of ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const) {
      const token = await ctx.env(source);
      if (token) {
        return {
          auth: { headers: { Authorization: `Bearer ${token}` } },
          source,
        };
      }
    }
    return undefined;
  },
};

export const gatewayAnthropicAuth = gatewayAuth;

export function toGatewayModel(providerId: GatewayProviderId, model: Model<Api>): Model<Api> {
  const modelId = (GATEWAY_MODEL_IDS[providerId] as Readonly<Record<string, string>>)[model.id];
  if (!modelId) {
    throw new Error(`Model ${providerId}/${model.id} is not allowed through Vercel AI Gateway`);
  }
  return {
    ...model,
    id: modelId,
    baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
  };
}

export function toGatewayAnthropicModel(model: Model<Api>): Model<Api> {
  return toGatewayModel("anthropic", model);
}

function gatewayApi(providerId: GatewayProviderId, api: ProviderStreams): ProviderStreams {
  return {
    stream: (model, context, options) =>
      api.stream(toGatewayModel(providerId, model), context, options),
    streamSimple: (model, context, options) =>
      api.streamSimple(toGatewayModel(providerId, model), context, options),
  };
}

function gatewayModels(providerId: GatewayProviderId, models: readonly Model<Api>[]): Model<Api>[] {
  return models
    .filter((model) => Object.hasOwn(GATEWAY_MODEL_IDS[providerId], model.id))
    .map((model) => ({ ...model, baseUrl: VERCEL_AI_GATEWAY_BASE_URL }));
}

export const anthropicGatewayProvider = createProvider({
  id: "anthropic",
  name: "Anthropic via Vercel AI Gateway",
  baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
  auth: { apiKey: gatewayAuth },
  models: gatewayModels("anthropic", anthropicProvider().getModels()),
  api: gatewayApi("anthropic", anthropicMessagesApi()),
});

export const openaiGatewayProvider = createProvider({
  id: "openai",
  name: "OpenAI via Vercel AI Gateway",
  baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
  auth: { apiKey: gatewayAuth },
  models: gatewayModels("openai", openaiProvider().getModels()),
  api: gatewayApi("openai", openAIResponsesApi()),
});

export const xaiGatewayProvider = createProvider({
  id: "xai",
  name: "xAI via Vercel AI Gateway",
  baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
  auth: { apiKey: gatewayAuth },
  models: gatewayModels("xai", xaiProvider().getModels()),
  api: gatewayApi("xai", openAIResponsesApi()),
});

export const googleGatewayProvider = createProvider({
  id: "google",
  name: "Google via Vercel AI Gateway",
  baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
  auth: { apiKey: gatewayAuth },
  models: gatewayModels("google", googleProvider().getModels()),
  api: gatewayApi("google", googleGenerativeAIApi()),
});

setProvider(anthropicGatewayProvider);
setProvider(openaiGatewayProvider);
setProvider(xaiGatewayProvider);
setProvider(googleGatewayProvider);

if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  console.warn(
    "[reading-agent] Vercel AI Gateway is not configured. Set AI_GATEWAY_API_KEY " +
      "(preferred) or VERCEL_OIDC_TOKEN for local model calls; the sidecar will still boot.",
  );
}
