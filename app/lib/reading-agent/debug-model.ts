export const DEBUG_READING_AGENT_MODELS = [
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.5",
  "xai/grok-4.5",
  "google/gemini-2.5-flash",
] as const;

export type DebugReadingAgentModel = (typeof DEBUG_READING_AGENT_MODELS)[number];

export const DEFAULT_DEBUG_READING_AGENT_MODEL: DebugReadingAgentModel =
  "anthropic/claude-sonnet-4-6";

export function isDebugReadingAgentModel(value: unknown): value is DebugReadingAgentModel {
  return DEBUG_READING_AGENT_MODELS.some((model) => model === value);
}
