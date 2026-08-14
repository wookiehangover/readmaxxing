import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
const createFlueClient = vi.hoisted(() => vi.fn(() => ({ send, read })));

vi.mock("@flue/sdk", () => ({ createFlueClient }));

import { callReadingScribe } from "../flue-client.server";

const result = {
  outline: { status: "unchanged", body: "", summary: "No outline change." },
  characters: { status: "unchanged", body: "", summary: "No character change." },
  wiki: { status: "updated", body: "Expanded story.", summary: "Added the new scene." },
};
const unknownUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
  model: null,
  source: "unknown",
};
const callResult = { artifacts: result, usage: unknownUsage };

beforeEach(() => {
  createFlueClient.mockClear();
  send.mockReset().mockResolvedValue({ submissionId: "submission-1" });
  read.mockReset().mockResolvedValue({ text: JSON.stringify(result) });
});

describe("ReadingScribe Flue client", () => {
  it("accepts a bare JSON reply and uses the durable SDK round trip", async () => {
    await expect(
      callReadingScribe({
        url: "http://localhost:5174/agents/reading-scribe/conversation-1",
        secret: "test-secret",
        page: "New page text.",
        artifacts: { outline: "", characters: "", wiki: "Existing story." },
      }),
    ).resolves.toEqual(callResult);

    expect(createFlueClient).toHaveBeenCalledWith({
      url: "http://localhost:5174/agents/reading-scribe/conversation-1",
      token: "test-secret",
    });
    expect(send).toHaveBeenCalledWith({
      message: {
        kind: "user",
        body: JSON.stringify({
          page: "New page text.",
          artifacts: { outline: "", characters: "", wiki: "Existing story." },
        }),
      },
    });
    expect(read).toHaveBeenCalledWith({ submissionId: "submission-1" });
  });

  it("accepts a JSON reply in a markdown fence", async () => {
    read.mockResolvedValue({ text: `\`\`\`json\n${JSON.stringify(result)}\n\`\`\`` });

    await expect(
      callReadingScribe({
        url: "http://localhost/agent/id",
        secret: "test-secret",
        page: "Page",
        artifacts: { outline: "", characters: "", wiki: "" },
      }),
    ).resolves.toEqual(callResult);
  });

  it("defaults summaries omitted from a fenced JSON reply", async () => {
    const withoutSummaries = {
      outline: { status: "updated", body: "New outline." },
      characters: { status: "unchanged", body: "Existing characters." },
      wiki: { status: "updated", body: "New wiki." },
    };
    read.mockResolvedValue({
      text: `\`\`\`json\n${JSON.stringify(withoutSummaries)}\n\`\`\``,
    });

    await expect(
      callReadingScribe({
        url: "http://localhost/agent/id",
        secret: "test-secret",
        page: "Page",
        artifacts: { outline: "", characters: "", wiki: "" },
      }),
    ).resolves.toEqual({
      artifacts: {
        outline: { ...withoutSummaries.outline, summary: "Updated outline." },
        characters: { ...withoutSummaries.characters, summary: "No characters change." },
        wiki: { ...withoutSummaries.wiki, summary: "Updated wiki." },
      },
      usage: unknownUsage,
    });
  });

  it("accepts a JSON object padded with prose", async () => {
    read.mockResolvedValue({ text: `Here is the result:\n${JSON.stringify(result)}\nDone.` });

    await expect(
      callReadingScribe({
        url: "http://localhost/agent/id",
        secret: "test-secret",
        page: "Page",
        artifacts: { outline: "", characters: "", wiki: "" },
      }),
    ).resolves.toEqual(callResult);
  });

  it("extracts PromptUsage from reply metadata", async () => {
    read.mockResolvedValue({
      text: JSON.stringify(result),
      metadata: {
        usage: {
          input: 100,
          output: 20,
          cacheRead: 5,
          cacheWrite: 2,
          totalTokens: 127,
          cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
        },
        model: { provider: "anthropic", id: "claude-sonnet-4-6" },
      },
    });

    await expect(
      callReadingScribe({
        url: "http://localhost/agent/id",
        secret: "test-secret",
        page: "Page",
        artifacts: { outline: "", characters: "", wiki: "" },
      }),
    ).resolves.toEqual({
      artifacts: result,
      usage: {
        input: 100,
        output: 20,
        cacheRead: 5,
        cacheWrite: 2,
        totalTokens: 127,
        costTotal: 0.003,
        model: "anthropic/claude-sonnet-4-6",
        source: "flue",
      },
    });
  });

  it("rejects an invalid structured reply", async () => {
    read.mockResolvedValue({ text: "not json" });
    await expect(
      callReadingScribe({
        url: "http://localhost/agent/id",
        secret: "test-secret",
        page: "Page",
        artifacts: { outline: "", characters: "", wiki: "" },
      }),
    ).rejects.toThrow("ReadingScribe reply was not valid JSON");
  });
});
