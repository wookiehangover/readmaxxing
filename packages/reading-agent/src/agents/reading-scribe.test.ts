import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  delivery: vi.fn(),
  model: vi.fn(),
  sandbox: vi.fn(),
  tool: vi.fn(),
}));

vi.mock("@flue/runtime", () => ({
  useDelivery: mocks.delivery,
  useModel: mocks.model,
  useSandbox: mocks.sandbox,
  useTool: mocks.tool,
}));
vi.mock("../providers/vercel-ai-gateway", () => ({}));
vi.mock("../sandboxes/reading-sandbox", () => ({ readingSandbox: vi.fn() }));
vi.mock("../tools/update-reading-artifacts", () => ({ updateReadingArtifacts: vi.fn() }));

import { ReadingScribe } from "./reading-scribe";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReadingScribe delivery model", () => {
  it.each(["openai/gpt-5.6-luna", "openai/gpt-5.6-terra", "openai/gpt-5.6-sol"])(
    "accepts %s",
    (model) => {
      mocks.delivery.mockReturnValue({ kind: "user", body: JSON.stringify({ model }) });

      ReadingScribe();

      expect(mocks.model).toHaveBeenCalledWith(model);
    },
  );

  it("falls back to Claude Sonnet for an unknown model", () => {
    mocks.delivery.mockReturnValue({
      kind: "user",
      body: JSON.stringify({ model: "openai/not-allowed" }),
    });

    ReadingScribe();

    expect(mocks.model).toHaveBeenCalledWith("anthropic/claude-sonnet-4-6");
  });
});
