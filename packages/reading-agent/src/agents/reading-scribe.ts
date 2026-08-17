"use agent";
import { useDelivery, useModel, useSandbox, useTool } from "@flue/runtime";
import { READING_SCRIBE_PROMPT } from "../artifacts/prompt";
import "../providers/vercel-ai-gateway";
import { readingSandbox } from "../sandboxes/reading-sandbox";
import { updateReadingArtifacts } from "../tools/update-reading-artifacts";

const DEFAULT_MODEL = "openai/gpt-5.6-terra";
const MODELS = new Set([
  DEFAULT_MODEL,
  "openai/gpt-5.5",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol",
  "xai/grok-4.5",
  "google/gemini-2.5-flash",
]);

function useDeliveryModel(): string {
  const delivery = useDelivery();
  if (delivery.kind !== "user") return DEFAULT_MODEL;
  try {
    const value: unknown = JSON.parse(delivery.body);
    if (typeof value !== "object" || value === null || !("model" in value)) return DEFAULT_MODEL;
    const model = value.model;
    return typeof model === "string" && MODELS.has(model) ? model : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function ReadingScribe() {
  useModel(useDeliveryModel());
  useSandbox(readingSandbox());
  useTool(updateReadingArtifacts);
  return READING_SCRIBE_PROMPT;
}
