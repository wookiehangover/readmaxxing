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

beforeEach(() => {
  createFlueClient.mockClear();
  send.mockReset().mockResolvedValue({ submissionId: "submission-1" });
  read.mockReset().mockResolvedValue({ text: JSON.stringify(result) });
});

describe("ReadingScribe Flue client", () => {
  it("uses the shared secret and durable SDK send/read round trip", async () => {
    await expect(
      callReadingScribe({
        url: "http://localhost:5174/agents/reading-scribe/conversation-1",
        secret: "test-secret",
        page: "New page text.",
        artifacts: { outline: "", characters: "", wiki: "Existing story." },
      }),
    ).resolves.toEqual(result);

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
