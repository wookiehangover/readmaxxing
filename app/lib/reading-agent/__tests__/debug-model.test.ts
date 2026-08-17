import { afterEach, describe, expect, it } from "vitest";
import {
  DEBUG_READING_AGENT_MODELS,
  DEFAULT_DEBUG_READING_AGENT_MODEL,
  getSelectedDebugModel,
  setSelectedDebugModel,
} from "../debug-model.server";

afterEach(() => {
  setSelectedDebugModel(DEFAULT_DEBUG_READING_AGENT_MODEL);
});

describe("reading-agent debug model", () => {
  it("defaults to GPT-5.6 Terra and accepts every allowlisted model", () => {
    expect(DEFAULT_DEBUG_READING_AGENT_MODEL).toBe("openai/gpt-5.6-terra");
    expect(getSelectedDebugModel()).toBe("openai/gpt-5.6-terra");
    for (const model of DEBUG_READING_AGENT_MODELS) {
      expect(setSelectedDebugModel(model)).toBe(model);
      expect(getSelectedDebugModel()).toBe(model);
    }
  });

  it("rejects invalid ids without changing the selected model", () => {
    expect(() => setSelectedDebugModel("openai/not-allowed")).toThrow(RangeError);
    expect(getSelectedDebugModel()).toBe(DEFAULT_DEBUG_READING_AGENT_MODEL);

    setSelectedDebugModel("openai/gpt-5.5");

    expect(() => setSelectedDebugModel("openai/not-allowed")).toThrow(RangeError);
    expect(getSelectedDebugModel()).toBe("openai/gpt-5.5");
  });
});
