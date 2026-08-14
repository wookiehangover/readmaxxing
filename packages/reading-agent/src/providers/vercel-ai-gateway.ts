import { setProvider } from "@flue/runtime";
import {
  createProvider,
  type Api,
  type ApiKeyAuth,
  type Model,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

export const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

const GATEWAY_MODEL_IDS: Readonly<Record<string, string>> = {
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
};

export const gatewayAnthropicAuth: ApiKeyAuth = {
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

export function toGatewayAnthropicModel(model: Model<Api>): Model<Api> {
  return {
    ...model,
    id: GATEWAY_MODEL_IDS[model.id] ?? model.id,
    baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
  };
}

const anthropicApi = anthropicMessagesApi();
const gatewayAnthropicApi: ProviderStreams = {
  stream: (model, context, options) =>
    anthropicApi.stream(toGatewayAnthropicModel(model), context, options),
  streamSimple: (model, context, options) =>
    anthropicApi.streamSimple(toGatewayAnthropicModel(model), context, options),
};

const nativeAnthropicProvider = anthropicProvider();

export const anthropicGatewayProvider = createProvider({
  id: "anthropic",
  name: "Anthropic via Vercel AI Gateway",
  baseUrl: VERCEL_AI_GATEWAY_BASE_URL,
  auth: { apiKey: gatewayAnthropicAuth },
  models: nativeAnthropicProvider
    .getModels()
    .map((model) => ({ ...model, baseUrl: VERCEL_AI_GATEWAY_BASE_URL })),
  api: gatewayAnthropicApi,
});

setProvider(anthropicGatewayProvider);

if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  console.warn(
    "[reading-agent] Vercel AI Gateway is not configured. Set AI_GATEWAY_API_KEY " +
      "(preferred) or VERCEL_OIDC_TOKEN for local model calls; the sidecar will still boot.",
  );
}
