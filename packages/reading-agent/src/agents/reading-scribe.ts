"use agent";
import { useModel, useSandbox, useTool } from "@flue/runtime";
import { READING_SCRIBE_PROMPT } from "../artifacts/prompt";
import "../providers/vercel-ai-gateway";
import { readingSandbox } from "../sandboxes/reading-sandbox";
import { updateReadingArtifacts } from "../tools/update-reading-artifacts";

export function ReadingScribe() {
  useModel("anthropic/claude-sonnet-4-6");
  useSandbox(readingSandbox());
  useTool(updateReadingArtifacts);
  return READING_SCRIBE_PROMPT;
}
