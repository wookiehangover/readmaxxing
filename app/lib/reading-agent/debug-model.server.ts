import {
  DEFAULT_DEBUG_READING_AGENT_MODEL,
  isDebugReadingAgentModel,
  type DebugReadingAgentModel,
} from "./debug-model";

export {
  DEBUG_READING_AGENT_MODELS,
  DEFAULT_DEBUG_READING_AGENT_MODEL,
  isDebugReadingAgentModel,
  type DebugReadingAgentModel,
} from "./debug-model";

let selectedModel: DebugReadingAgentModel = DEFAULT_DEBUG_READING_AGENT_MODEL;

export function getSelectedDebugModel(): DebugReadingAgentModel {
  return selectedModel;
}

export function setSelectedDebugModel(value: unknown): DebugReadingAgentModel {
  if (!isDebugReadingAgentModel(value)) {
    throw new RangeError("Unsupported reading-agent debug model");
  }
  selectedModel = value;
  return selectedModel;
}
