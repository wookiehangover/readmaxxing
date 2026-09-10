// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity, listing, tone } from "../src/terminal";
import { run } from "../src/main";

const ttyDescriptors = [process.stdout, process.stderr].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY"),
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TERM", "xterm-256color");
  vi.stubEnv("CI", "");
  vi.stubEnv("NO_COLOR", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  [process.stdout, process.stderr].forEach((stream, index) => {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else Reflect.deleteProperty(stream, "isTTY");
  });
});

function capture(tty: boolean) {
  for (const stream of [process.stderr, process.stdout])
    Object.defineProperty(stream, "isTTY", { configurable: true, value: tty });
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return { stderr, stdout };
}

describe("terminal output", () => {
  it("keeps redirected listings as TSV and emits no animation", async () => {
    const { stderr, stdout } = capture(false);
    await new Activity("Loading").during(async () => vi.advanceTimersByTime(200));
    listing(["ID", "TITLE"], [["id", "A\nB\x1b[31m"]], "Empty");
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("ID\tTITLE\nid\tA B\n");
  });

  it("clears progress after failure, stops its timer, and never touches stdout", async () => {
    const { stderr, stdout } = capture(true);
    const activity = new Activity("Uploading");
    activity.update({ label: "Uploading", loaded: 512, total: 1024 });
    vi.advanceTimersByTime(80);
    expect(stderr.mock.calls.flat().join("")).toContain("50%");
    await expect(
      activity.during(async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(stderr).toHaveBeenLastCalledWith("\r\x1b[2K");
    const count = stderr.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(stderr).toHaveBeenCalledTimes(count);
    expect(stdout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors NO_COLOR, dumb terminals, and CI", async () => {
    const { stderr } = capture(true);
    vi.stubEnv("NO_COLOR", "1");
    expect(tone("text", 36)).toBe("text");
    vi.stubEnv("TERM", "dumb");
    await new Activity("Loading").during(async () => vi.advanceTimersByTime(160));
    vi.stubEnv("TERM", "xterm");
    vi.stubEnv("CI", "1");
    await new Activity("Loading").during(async () => vi.advanceTimersByTime(160));
    expect(stderr).not.toHaveBeenCalled();
  });

  it("offers command-specific help without reading credentials or networking", async () => {
    const { stdout } = capture(false);
    vi.stubEnv("READMAXXING_CONFIG", "/does/not/exist/config.json");
    await run(["upload", "--help"]);
    const output = String(stdout.mock.calls[0][0]);
    expect(output).toContain("--author");
    expect(output).not.toContain("--session");
    expect(output).not.toContain("localhost callback");
    stdout.mockClear();
    await run(["help", "upload"]);
    expect(stdout).toHaveBeenCalledWith(output);
  });

  it("groups interleaved chats by book ID and keeps missing books visible", async () => {
    const { stdout } = capture(true);
    vi.stubEnv("NO_COLOR", "1");
    vi.stubEnv("READMAXXING_CONFIG", "/does/not/exist/config.json");
    vi.stubEnv("READMAXXING_URL", "https://readmaxxing.app");
    vi.stubEnv("READMAXXING_TOKEN", "12345678-1234-1234-1234-123456789abc");
    const sessions = [
      { id: "chat-1", title: "First", bookId: "book-a" },
      { id: "chat-2", title: "Second", bookId: "book-b" },
      { id: "chat-3", title: "Third", bookId: "book-a" },
      { id: "chat-4", title: "Lost", bookId: "missing" },
      { id: "chat-5", title: null, bookId: null },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const entity = new URL(String(url)).searchParams.get("entityType");
      return Response.json({
        changes: [
          {
            entity,
            records:
              entity === "book"
                ? [
                    { id: "book-a", title: "Same title", author: "Author" },
                    { id: "book-b", title: "Same title" },
                  ]
                : sessions,
            hasMore: false,
          },
        ],
      });
    });
    await run(["chats"]);
    const output = stdout.mock.calls.map(([value]) => value).join("");
    expect(output).toContain(
      "Same title · Author\n  book-a\n\n  First\n    chat-1\n  Third\n    chat-3",
    );
    expect(output).toContain("Same title\n  book-b\n\n  Second\n    chat-2");
    expect(output).toContain("Unknown book\n  missing\n\n  Lost\n    chat-4");
    expect(output).toContain("No book\n\n  Untitled\n    chat-5");
    stdout.mockClear();
    await run(["chats", "--book", "book-a"]);
    const filtered = stdout.mock.calls.map(([value]) => value).join("");
    expect(filtered).toContain("chat-1");
    expect(filtered).toContain("chat-3");
    expect(filtered).not.toContain("chat-2");
    expect(filtered).not.toContain("Unknown book");
  });

  it.each(["terminal", "json", "tsv"])(
    "excludes deleted-book chats from %s listings, including --book",
    async (format) => {
      const { stdout } = capture(format !== "tsv");
      vi.stubEnv("READMAXXING_CONFIG", "/does/not/exist/config.json");
      vi.stubEnv("READMAXXING_URL", "https://readmaxxing.app");
      vi.stubEnv("READMAXXING_TOKEN", "12345678-1234-1234-1234-123456789abc");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = new URL(String(input));
        const entity = url.searchParams.get("entityType");
        if (entity === "chat_session")
          return Response.json({
            changes: [
              {
                entity,
                records: [
                  { id: "keep-chat", bookId: "live", title: "Keep" },
                  { id: "hide-chat", bookId: "deleted", title: "Hide" },
                  { id: "unassigned-chat", bookId: null, title: "Unassigned" },
                  { id: "removed-session", bookId: "live", deletedAt: "2026-01-01" },
                ],
                hasMore: false,
              },
            ],
          });
        // The deletion is on a later page, so filtering must wait for the complete book pull.
        return Response.json({
          changes: [
            {
              entity,
              records: url.searchParams.has("cursors")
                ? [{ id: "deleted", title: "Deleted book", deletedAt: "2026-01-01" }]
                : [{ id: "live", title: "Live book", deletedAt: null }],
              cursor: "next-page",
              hasMore: !url.searchParams.has("cursors"),
            },
          ],
        });
      });
      const options = format === "json" ? ["--json"] : [];
      await run(["chats", ...options]);
      const output = stdout.mock.calls.map(([value]) => value).join("");
      expect(output).toContain("keep-chat");
      expect(output).toContain("unassigned-chat");
      expect(output).not.toContain("hide-chat");
      expect(output).not.toContain("removed-session");
      expect(output).not.toContain("Deleted book");
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      if (format === "json")
        expect(JSON.parse(output).map((chat: { id: string }) => chat.id)).toEqual([
          "keep-chat",
          "unassigned-chat",
        ]);
      stdout.mockClear();
      await run(["chats", "--book", "deleted", ...options]);
      const filtered = stdout.mock.calls.map(([value]) => value).join("");
      expect(filtered).not.toContain("hide-chat");
      if (format === "json") expect(JSON.parse(filtered)).toEqual([]);
      else if (format === "terminal") expect(filtered).toBe("No conversations found.\n");
      else expect(filtered).toBe("ID\tTITLE\tBOOK\n");
    },
  );

  it.each([
    ["books", "book"],
    ["chats", "chat_session"],
  ])("prints valid %s JSON without extra metadata requests", async (command, entity) => {
    const { stdout } = capture(true);
    vi.stubEnv("READMAXXING_CONFIG", "/does/not/exist/config.json");
    vi.stubEnv("READMAXXING_URL", "https://readmaxxing.app");
    vi.stubEnv("READMAXXING_TOKEN", "12345678-1234-1234-1234-123456789abc");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        changes: [{ entity, records: [{ id: "one", title: "Book" }], hasMore: false }],
      }),
    );
    await run([command, "--json"]);
    expect(JSON.parse(stdout.mock.calls.map(([value]) => value).join(""))).toEqual([
      { id: "one", title: "Book" },
    ]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
