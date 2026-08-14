"use agent";
import { useModel } from "@flue/runtime";

// Every exported capitalized function in a 'use agent' module is an agent,
// and the function's name is its durable identity. The return value is the
// agent's system prompt.
export function ReadingScribe() {
  useModel("anthropic/claude-sonnet-4-6");
  return "You are a reading scribe. Keep replies short.";
}
