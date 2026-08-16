import { gateway } from "@ai-sdk/gateway";
import { generateObject, NoObjectGeneratedError, type LanguageModelUsage } from "ai";
import { z } from "zod";
import type { ReadingAgentUsage } from "~/lib/database/reading-artifact/reading-artifact";
import type { DebugReadingAgentModel } from "./debug-model.server";

export const PAGE_INCREMENT_TIMEOUT_MS = 60_000;

const PageIncrementSchema = z.object({
  bullets: z
    .array(z.string().trim().min(1).max(240))
    .max(3)
    .describe("Zero to three short factual bullets added by this page"),
});

const GATEWAY_MODELS = {
  "anthropic/claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.5": "openai/gpt-5.5",
  "openai/gpt-5.6-luna": "openai/gpt-5.6-luna",
  "openai/gpt-5.6-terra": "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol": "openai/gpt-5.6-sol",
  "xai/grok-4.5": "xai/grok-4.5",
  "google/gemini-2.5-flash": "google/gemini-2.5-flash",
} as const;

export interface PageIncrementCallResult {
  bullets: string[];
  usage: ReadingAgentUsage;
}

function usageRecord(
  usage: LanguageModelUsage,
  model: string | null | undefined,
): ReadingAgentUsage {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return {
    input,
    output,
    cacheRead: usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWrite: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    totalTokens: usage.totalTokens ?? input + output,
    costTotal: 0,
    model: model ?? null,
    source: "ai-sdk",
  };
}

export function pageIncrementUsageFromError(
  error: unknown,
  fallbackModel: DebugReadingAgentModel,
): ReadingAgentUsage {
  if (NoObjectGeneratedError.isInstance(error) && error.usage) {
    return usageRecord(error.usage, error.response?.modelId ?? fallbackModel);
  }
  return usageRecord(
    {
      inputTokens: 0,
      inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokens: 0,
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      totalTokens: 0,
    },
    fallbackModel,
  );
}

export async function callPageIncrement(options: {
  model: DebugReadingAgentModel;
  page: string;
  chapterLabel: string | null;
  existingBullets: readonly string[];
}): Promise<PageIncrementCallResult> {
  const result = await generateObject({
    model: gateway(GATEWAY_MODELS[options.model]),
    schema: PageIncrementSchema,
    schemaName: "reading_page_increment",
    maxOutputTokens: 512,
    abortSignal: AbortSignal.timeout(PAGE_INCREMENT_TIMEOUT_MS),
    instructions:
      "Create an incremental reading outline from the current page. Return zero to three short, factual bullets containing only concrete new information from the page. Do not interpret, editorialize, speculate, or repeat an existing bullet. Return an empty bullets array when the page adds nothing. Do not add Markdown prefixes.",
    prompt: JSON.stringify({
      chapterLabel: options.chapterLabel?.trim() || "Untitled",
      existingBullets: options.existingBullets,
      pageText: options.page,
    }),
  });

  return {
    bullets: result.object.bullets,
    usage: usageRecord(result.usage, result.response.modelId),
  };
}
