// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createSession: vi.fn(),
  book: vi.fn(),
  notebook: vi.fn(),
  artifacts: vi.fn(),
  session: vi.fn(),
  sessions: vi.fn(),
  messages: vi.fn(),
}));
vi.mock("~/lib/database/auth-middleware", () => ({ requireAuth: mocks.auth }));
vi.mock("~/lib/database/auth/session", () => ({ createSession: mocks.createSession }));
vi.mock("~/lib/database/book/book", () => ({ getBookByIdForUser: mocks.book }));
vi.mock("~/lib/database/annotation/notebook", () => ({
  getNotebookMarkdownForUser: mocks.notebook,
}));
vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  getCurrentReadingArtifacts: mocks.artifacts,
}));
vi.mock("~/lib/database/chat/chat-session", () => ({
  getSessionByIdForUser: mocks.session,
  getSessionsByUserAndBook: mocks.sessions,
  getMessagesBySession: mocks.messages,
}));
import { action } from "../api.auth.cli";
import { loader } from "../api.cli.export";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: "owner" });
  mocks.book.mockResolvedValue({ id: "book", deletedAt: null });
});
const origin = "https://readmaxxing.example";
describe("CLI authorization", () => {
  it("requires browser approval from the same origin", async () => {
    for (const headers of [new Headers(), new Headers({ Origin: "https://attacker.example" })]) {
      const response = await action({
        request: new Request(`${origin}/api/auth/cli`, { method: "POST", headers }),
      });
      expect(response.status).toBe(403);
    }
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("issues an independent expiring session without replacing the browser cookie", async () => {
    mocks.createSession.mockResolvedValue({ id: "new-session", expiresAt: new Date("2026-10-01") });
    const response = await action({
      request: new Request(`${origin}/api/auth/cli`, {
        method: "POST",
        headers: { Origin: origin },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.json()).toMatchObject({ token: "new-session" });
    expect(mocks.createSession).toHaveBeenCalledWith("owner", expect.any(Date));
    const expiry = mocks.createSession.mock.calls[0][1] as Date;
    expect(expiry.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });
  it("rejects unauthenticated sessions and unsupported methods", async () => {
    mocks.auth.mockRejectedValue(new Response("", { status: 401 }));
    await expect(
      action({
        request: new Request(`${origin}/api/auth/cli`, {
          method: "POST",
          headers: { Origin: origin },
        }),
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await action({ request: new Request(`${origin}/api/auth/cli`, { method: "DELETE" }) }))
        .status,
    ).toBe(405);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe("Markdown exports", () => {
  const request = (query: string) =>
    loader({ request: new Request(`${origin}/api/cli/export?${query}`) });
  it("checks auth and book ownership before exporting notebooks", async () => {
    mocks.notebook.mockResolvedValue("# Notes\n\n**Bold**");
    const response = await request("kind=notes&bookId=book");
    expect(await response.text()).toBe("# Notes\n\n**Bold**\n");
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(mocks.book).toHaveBeenCalledWith("book", "owner");
    expect(mocks.notebook).toHaveBeenCalledWith("owner", "book");
  });
  it("rejects missing, deleted, and other users' books", async () => {
    for (const book of [null, { id: "book", deletedAt: new Date() }]) {
      mocks.book.mockResolvedValue(book);
      expect((await request("kind=notes&bookId=book")).status).toBe(404);
    }
    expect(mocks.notebook).not.toHaveBeenCalled();
  });
  it("returns outline Markdown and empty content for an absent outline", async () => {
    mocks.artifacts.mockResolvedValueOnce([{ kind: "outline", content: "# Plot\n\n- Arrival" }]);
    expect(await (await request("kind=outline&bookId=book")).text()).toBe("# Plot\n\n- Arrival\n");
    mocks.artifacts.mockResolvedValueOnce([]);
    expect(await (await request("kind=outline&bookId=book")).text()).toBe("");
  });
  it("exports chronological chats, text parts and legacy text, excluding tool payloads", async () => {
    mocks.sessions.mockResolvedValue([
      { id: "new", title: "Second", createdAt: new Date("2026-02-01"), activeStreamId: "stream" },
      { id: "old", title: "First", createdAt: new Date("2026-01-01"), activeStreamId: null },
    ]);
    mocks.messages.mockImplementation(async (id: string) =>
      id === "old"
        ? [
            { role: "user", content: "Legacy question" },
            {
              role: "assistant",
              content: "fallback",
              parts: [
                { type: "text", text: "**Answer**" },
                { type: "reasoning", text: "private reasoning" },
                { type: "tool-secret", output: "secret" },
              ],
            },
          ]
        : [],
    );
    const markdown = await (await request("kind=chat&bookId=book")).text();
    expect(markdown.indexOf("# First")).toBeLessThan(markdown.indexOf("# Second"));
    expect(markdown).toContain("## You\n\nLegacy question");
    expect(markdown).toContain("## Assistant\n\n**Answer**");
    expect(markdown).not.toMatch(/secret|private reasoning|fallback/);
    expect(markdown).toContain("still being generated");
  });
  it("scopes individual chat exports to the authenticated owner", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await request("kind=chat&sessionId=other-users-chat")).status).toBe(404);
    expect(mocks.session).toHaveBeenCalledWith("other-users-chat", "owner");
    expect(mocks.messages).not.toHaveBeenCalled();
  });
  it("rejects invalid selectors and unauthenticated reads", async () => {
    for (const query of [
      "kind=other&bookId=book",
      "kind=notes",
      "kind=notes&sessionId=chat",
      "kind=chat&bookId=book&sessionId=chat",
    ]) {
      expect((await request(query)).status).toBe(400);
    }
    mocks.auth.mockRejectedValue(new Response("", { status: 401 }));
    await expect(request("kind=notes&bookId=book")).rejects.toMatchObject({ status: 401 });
  });
});
