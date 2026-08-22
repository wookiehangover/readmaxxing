import type { UIMessage } from "@ai-sdk/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ensureBookChaptersUploaded: vi.fn(async () => {}) }));

vi.mock("~/lib/sync/book-chapter-uploads", () => ({
  ensureBookChaptersUploaded: mocks.ensureBookChaptersUploaded,
}));

import { CHAT_SEND_RETRY_DELAYS_MS, createChatTransport } from "../chat-utils";

const message: UIMessage = {
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text: "Hello" }],
};

function createTransport(onPreparingChange = vi.fn()) {
  return {
    onPreparingChange,
    transport: createChatTransport({
      sessionId: "session-1",
      bookId: "book-1",
      visibleTextRef: { current: "Visible" },
      currentChapterRef: { current: 2 },
      selectedBookIdsRef: { current: ["book-1"] },
      getBookContext: () => ({ visibleText: "Visible", currentChapterIndex: 2 }),
      onPreparingChange,
    }),
  };
}

function sendMessage(transport: ReturnType<typeof createTransport>["transport"]) {
  return transport.sendMessages({
    trigger: "submit-message",
    chatId: "session-1",
    messageId: undefined,
    messages: [message],
    abortSignal: undefined,
  });
}

function response(status: number, error?: string): Response {
  if (status === 200) return new Response("data: [DONE]\n\n", { status });
  return Response.json({ error }, { status });
}

describe("createChatTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    [404, "Book not found"],
    [404, "Session not found"],
    [400, "Book chapters not uploaded. Upload chapters before starting a chat."],
  ])("prepares the book and retries retryable %i responses", async (status, error) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response(status, error)).mockResolvedValueOnce(response(200)),
    );
    const pushNeeded = vi.fn();
    window.addEventListener("sync:push-needed", pushNeeded);
    const { transport, onPreparingChange } = createTransport();

    const send = sendMessage(transport);
    await vi.runAllTimersAsync();
    await send;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.ensureBookChaptersUploaded).toHaveBeenCalledWith("book-1");
    expect(pushNeeded).toHaveBeenCalledOnce();
    expect(onPreparingChange.mock.calls).toEqual([[true], [false]]);
    window.removeEventListener("sync:push-needed", pushNeeded);
  });

  it.each([
    [400, "message with role='user' is required"],
    [401, "auth_required"],
    [503, "Sync not configured"],
  ])("does not retry unrelated %i responses", async (status, error) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status, error)));
    const { transport, onPreparingChange } = createTransport();

    await expect(sendMessage(transport)).rejects.toThrow(error);

    expect(fetch).toHaveBeenCalledOnce();
    expect(mocks.ensureBookChaptersUploaded).not.toHaveBeenCalled();
    expect(onPreparingChange).not.toHaveBeenCalled();
  });

  it("stops after the finite retry budget and clears the preparing status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404, "Session not found")));
    const { transport, onPreparingChange } = createTransport();

    const send = sendMessage(transport);
    const rejection = expect(send).rejects.toThrow("Session not found");
    await vi.runAllTimersAsync();
    await rejection;

    expect(fetch).toHaveBeenCalledTimes(CHAT_SEND_RETRY_DELAYS_MS.length + 1);
    expect(mocks.ensureBookChaptersUploaded).toHaveBeenCalledTimes(
      CHAT_SEND_RETRY_DELAYS_MS.length,
    );
    expect(onPreparingChange.mock.calls).toEqual([[true], [false]]);
  });
});
