import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getBook: vi.fn(),
  getChapters: vi.fn(),
  gateway: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("~/lib/database/book/book", () => ({ getBookByIdForUser: mocks.getBook }));
vi.mock("~/lib/database/book/book-chapters", () => ({
  getBookChaptersForUser: mocks.getChapters,
}));
vi.mock("@ai-sdk/gateway", () => ({ gateway: mocks.gateway }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));

import { action } from "~/routes/api.chapter-questions";

const mockModel = { id: "terra" };

function request(body: BodyInit = JSON.stringify({ bookId: "book-1", chapterIndex: 2 })) {
  return new Request("http://localhost/api/chapter-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ userId: "user-1" });
  mocks.getBook.mockReset().mockResolvedValue({ id: "book-1", title: "Test Book" });
  mocks.getChapters.mockReset().mockResolvedValue({
    chapters: [{ index: 2, title: "A Particular Argument", text: "Specific chapter text." }],
  });
  mocks.gateway.mockReset().mockReturnValue(mockModel);
  mocks.generateText
    .mockReset()
    .mockResolvedValue({ text: '["Question one?","Question two?","Question three?"]' });
});

describe("chapter questions API", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await action({ request: request() });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "auth_required" });
    expect(mocks.getBook).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{"],
    ["missing bookId", JSON.stringify({ chapterIndex: 2 })],
    ["invalid chapterIndex", JSON.stringify({ bookId: "book-1", chapterIndex: -1 })],
  ])("returns 400 for %s", async (_label, body) => {
    const response = await action({ request: request(body) });

    expect(response.status).toBe(400);
    expect(mocks.getBook).not.toHaveBeenCalled();
  });

  it("returns 404 when the stored chapter is missing", async () => {
    mocks.getChapters.mockResolvedValue({
      chapters: [{ index: 1, title: "Another Chapter", text: "Other text." }],
    });

    const response = await action({ request: request() });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Chapter not found" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("returns exactly three parsed questions generated from stored chapter text", async () => {
    const response = await action({ request: request() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      questions: ["Question one?", "Question two?", "Question three?"],
    });
    expect(mocks.getBook).toHaveBeenCalledWith("book-1", "user-1");
    expect(mocks.getChapters).toHaveBeenCalledWith("user-1", "book-1");
    expect(mocks.gateway).toHaveBeenCalledWith("openai/gpt-5.6-terra");
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        messages: [
          expect.objectContaining({ content: expect.stringContaining("Specific chapter text.") }),
        ],
      }),
    );
  });
});
