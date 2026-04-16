import { describe, it, expect } from "vitest";
import { lwwMerge, setUnionMerge, appendOnlyMerge } from "../merge";

// ---------------------------------------------------------------------------
// lwwMerge
// ---------------------------------------------------------------------------

describe("lwwMerge", () => {
  it("returns remote when remote is newer", () => {
    const local = { updatedAt: 100, value: "local" };
    const remote = { updatedAt: 200, value: "remote" };
    expect(lwwMerge(local, remote)).toBe(remote);
  });

  it("returns local when local is newer", () => {
    const local = { updatedAt: 200, value: "local" };
    const remote = { updatedAt: 100, value: "remote" };
    expect(lwwMerge(local, remote)).toBe(local);
  });

  it("returns remote on equal timestamps (server authority)", () => {
    const local = { updatedAt: 100, value: "local" };
    const remote = { updatedAt: 100, value: "remote" };
    expect(lwwMerge(local, remote)).toBe(remote);
  });
});

// ---------------------------------------------------------------------------
// setUnionMerge
// ---------------------------------------------------------------------------

type TestItem = { id: string; deletedAt?: number | null; updatedAt?: number };
const getId = (item: TestItem) => item.id;

describe("setUnionMerge", () => {
  it("unions disjoint sets", () => {
    const local: TestItem[] = [{ id: "a" }];
    const remote: TestItem[] = [{ id: "b" }];
    const result = setUnionMerge(local, remote, getId);
    expect(result.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("unions overlapping sets without duplicates", () => {
    const local: TestItem[] = [{ id: "a" }, { id: "b" }];
    const remote: TestItem[] = [{ id: "b" }, { id: "c" }];
    const result = setUnionMerge(local, remote, getId);
    expect(result.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("prefers non-deleted over deleted (remote deleted, local not)", () => {
    const local: TestItem[] = [{ id: "a" }];
    const remote: TestItem[] = [{ id: "a", deletedAt: 100 }];
    const result = setUnionMerge(local, remote, getId);
    expect(result).toHaveLength(1);
    expect(result[0].deletedAt).toBeUndefined();
  });

  it("prefers non-deleted over deleted (local deleted, remote not)", () => {
    const local: TestItem[] = [{ id: "a", deletedAt: 100 }];
    const remote: TestItem[] = [{ id: "a" }];
    const result = setUnionMerge(local, remote, getId);
    expect(result).toHaveLength(1);
    expect(result[0].deletedAt).toBeUndefined();
  });

  it("keeps the more recently deleted when both are deleted", () => {
    const local: TestItem[] = [{ id: "a", deletedAt: 100 }];
    const remote: TestItem[] = [{ id: "a", deletedAt: 200 }];
    const result = setUnionMerge(local, remote, getId);
    expect(result).toHaveLength(1);
    expect(result[0].deletedAt).toBe(200);
  });

  it("uses LWW fallback when both non-deleted and have updatedAt", () => {
    const local: TestItem[] = [{ id: "a", updatedAt: 100 }];
    const remote: TestItem[] = [{ id: "a", updatedAt: 200 }];
    const result = setUnionMerge(local, remote, getId);
    expect(result[0].updatedAt).toBe(200);
  });

  it("keeps local when both non-deleted and local updatedAt is newer", () => {
    const local: TestItem[] = [{ id: "a", updatedAt: 300 }];
    const remote: TestItem[] = [{ id: "a", updatedAt: 200 }];
    const result = setUnionMerge(local, remote, getId);
    expect(result[0].updatedAt).toBe(300);
  });

  it("keeps local when both non-deleted with no updatedAt", () => {
    const local: TestItem[] = [{ id: "a" }];
    const remote: TestItem[] = [{ id: "a" }];
    const result = setUnionMerge(local, remote, getId);
    // Without updatedAt, local stays (no LWW fallback fires)
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// appendOnlyMerge
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// setUnionMerge — highlight-shaped records
// ---------------------------------------------------------------------------

type HighlightItem = {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  color: string;
  updatedAt: number;
  deletedAt?: number | null;
};
const getHighlightId = (h: HighlightItem) => h.id;

function makeHighlight(overrides: Partial<HighlightItem> & { id: string }): HighlightItem {
  return {
    bookId: "book-1",
    cfiRange: "epubcfi(/6/4!/4/2)",
    text: "sample text",
    color: "#ffff00",
    updatedAt: 100,
    ...overrides,
  };
}

describe("setUnionMerge — highlights", () => {
  it("merges two disjoint highlight sets into their union", () => {
    const local = [makeHighlight({ id: "h1", text: "highlight one" })];
    const remote = [makeHighlight({ id: "h2", text: "highlight two" })];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(["h1", "h2"]);
  });

  it("same highlight on both sides — LWW by updatedAt (remote newer)", () => {
    const local = [makeHighlight({ id: "h1", updatedAt: 100, color: "#ff0000" })];
    const remote = [makeHighlight({ id: "h1", updatedAt: 200, color: "#00ff00" })];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe("#00ff00");
    expect(result[0].updatedAt).toBe(200);
  });

  it("same highlight on both sides — LWW by updatedAt (local newer)", () => {
    const local = [makeHighlight({ id: "h1", updatedAt: 300, color: "#ff0000" })];
    const remote = [makeHighlight({ id: "h1", updatedAt: 200, color: "#00ff00" })];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe("#ff0000");
    expect(result[0].updatedAt).toBe(300);
  });

  it("deleted on remote side — non-deleted local wins", () => {
    const local = [makeHighlight({ id: "h1", updatedAt: 100 })];
    const remote = [makeHighlight({ id: "h1", updatedAt: 200, deletedAt: 200 })];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(1);
    expect(result[0].deletedAt).toBeUndefined();
  });

  it("deleted on local side — non-deleted remote wins", () => {
    const local = [makeHighlight({ id: "h1", updatedAt: 100, deletedAt: 150 })];
    const remote = [makeHighlight({ id: "h1", updatedAt: 200 })];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(1);
    expect(result[0].deletedAt).toBeUndefined();
  });

  it("deleted on both sides — keeps the more recently deleted", () => {
    const local = [makeHighlight({ id: "h1", deletedAt: 100 })];
    const remote = [makeHighlight({ id: "h1", deletedAt: 300 })];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(1);
    expect(result[0].deletedAt).toBe(300);
  });

  it("new highlight on remote only — added to result", () => {
    const local: HighlightItem[] = [];
    const remote = [makeHighlight({ id: "h-new", text: "new from server" })];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("h-new");
    expect(result[0].text).toBe("new from server");
  });

  it("new highlight on local only — stays in result", () => {
    const local = [makeHighlight({ id: "h-local", text: "local only" })];
    const remote: HighlightItem[] = [];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("h-local");
  });

  it("multiple highlights across books merge correctly", () => {
    const local = [
      makeHighlight({ id: "h1", bookId: "book-1" }),
      makeHighlight({ id: "h2", bookId: "book-2" }),
    ];
    const remote = [
      makeHighlight({ id: "h2", bookId: "book-2", updatedAt: 200, color: "#0000ff" }),
      makeHighlight({ id: "h3", bookId: "book-1" }),
    ];
    const result = setUnionMerge(local, remote, getHighlightId);
    expect(result).toHaveLength(3);
    const h2 = result.find((r) => r.id === "h2")!;
    expect(h2.color).toBe("#0000ff");
  });
});

// ---------------------------------------------------------------------------
// lwwMerge — notebook-shaped records
// ---------------------------------------------------------------------------

type NotebookItem = {
  bookId: string;
  content: Record<string, unknown>;
  updatedAt: number;
};

function makeNotebook(overrides: Partial<NotebookItem> & { bookId: string }): NotebookItem {
  return {
    content: { type: "doc", content: [] },
    updatedAt: 100,
    ...overrides,
  };
}

describe("lwwMerge — notebooks", () => {
  it("remote newer — remote wins", () => {
    const local = makeNotebook({ bookId: "b1", updatedAt: 100, content: { local: true } });
    const remote = makeNotebook({ bookId: "b1", updatedAt: 200, content: { remote: true } });
    const result = lwwMerge(local, remote);
    expect(result).toBe(remote);
    expect(result.content).toEqual({ remote: true });
  });

  it("local newer — local wins", () => {
    const local = makeNotebook({ bookId: "b1", updatedAt: 300, content: { local: true } });
    const remote = makeNotebook({ bookId: "b1", updatedAt: 200, content: { remote: true } });
    const result = lwwMerge(local, remote);
    expect(result).toBe(local);
    expect(result.content).toEqual({ local: true });
  });

  it("equal timestamps — remote wins (server authority)", () => {
    const local = makeNotebook({ bookId: "b1", updatedAt: 100, content: { local: true } });
    const remote = makeNotebook({ bookId: "b1", updatedAt: 100, content: { remote: true } });
    const result = lwwMerge(local, remote);
    expect(result).toBe(remote);
  });
});

// ---------------------------------------------------------------------------
// appendOnlyMerge
// ---------------------------------------------------------------------------

describe("appendOnlyMerge", () => {
  it("unions disjoint sets", () => {
    const local = [{ id: "1", text: "a" }];
    const remote = [{ id: "2", text: "b" }];
    const result = appendOnlyMerge(local, remote, (i) => i.id);
    expect(result.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });

  it("deduplicates by ID", () => {
    const local = [{ id: "1", text: "local" }];
    const remote = [{ id: "1", text: "remote" }];
    const result = appendOnlyMerge(local, remote, (i) => i.id);
    expect(result).toHaveLength(1);
  });

  it("prefers remote copy for same ID (server authority)", () => {
    const local = [{ id: "1", text: "local" }];
    const remote = [{ id: "1", text: "remote" }];
    const result = appendOnlyMerge(local, remote, (i) => i.id);
    expect(result[0].text).toBe("remote");
  });

  it("never removes items", () => {
    const local = [
      { id: "1", text: "a" },
      { id: "2", text: "b" },
    ];
    const remote = [{ id: "1", text: "a-updated" }];
    const result = appendOnlyMerge(local, remote, (i) => i.id);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.id === "2")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// lwwMerge — chat session–shaped records
// ---------------------------------------------------------------------------

type ChatSessionItem = {
  id: string;
  bookId: string;
  title: string;
  updatedAt: number;
};

function makeChatSession(overrides: Partial<ChatSessionItem> & { id: string }): ChatSessionItem {
  return {
    bookId: "book-1",
    title: "Chat about chapter 1",
    updatedAt: 100,
    ...overrides,
  };
}

describe("lwwMerge — chat sessions", () => {
  it("remote newer session wins", () => {
    const local = makeChatSession({ id: "s1", updatedAt: 100, title: "old title" });
    const remote = makeChatSession({ id: "s1", updatedAt: 200, title: "new title" });
    const result = lwwMerge(local, remote);
    expect(result).toBe(remote);
    expect(result.title).toBe("new title");
  });

  it("local newer session wins", () => {
    const local = makeChatSession({ id: "s1", updatedAt: 300, title: "local title" });
    const remote = makeChatSession({ id: "s1", updatedAt: 200, title: "remote title" });
    const result = lwwMerge(local, remote);
    expect(result).toBe(local);
    expect(result.title).toBe("local title");
  });

  it("equal timestamps — remote wins (server authority)", () => {
    const local = makeChatSession({ id: "s1", updatedAt: 100, title: "local" });
    const remote = makeChatSession({ id: "s1", updatedAt: 100, title: "remote" });
    const result = lwwMerge(local, remote);
    expect(result).toBe(remote);
  });
});

// ---------------------------------------------------------------------------
// appendOnlyMerge — chat message–shaped records
// ---------------------------------------------------------------------------

type ChatMessageItem = {
  id: string;
  role: string;
  content: string;
  createdAt: number;
};

function makeChatMessage(overrides: Partial<ChatMessageItem> & { id: string }): ChatMessageItem {
  return {
    role: "user",
    content: "Hello",
    createdAt: 100,
    ...overrides,
  };
}

const getChatMsgId = (m: ChatMessageItem) => m.id;

describe("appendOnlyMerge — chat messages", () => {
  it("remote messages not present locally are added", () => {
    const local = [makeChatMessage({ id: "m1", content: "Hi" })];
    const remote = [
      makeChatMessage({ id: "m2", role: "assistant", content: "Hello!" }),
      makeChatMessage({ id: "m3", role: "user", content: "Tell me more" }),
    ];
    const result = appendOnlyMerge(local, remote, getChatMsgId);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id).sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("duplicate messages (same ID) are not added twice", () => {
    const local = [
      makeChatMessage({ id: "m1", content: "Hi" }),
      makeChatMessage({ id: "m2", content: "How are you?" }),
    ];
    const remote = [
      makeChatMessage({ id: "m1", content: "Hi" }),
      makeChatMessage({ id: "m2", content: "How are you?" }),
    ];
    const result = appendOnlyMerge(local, remote, getChatMsgId);
    expect(result).toHaveLength(2);
  });

  it("messages are never removed even if absent from remote", () => {
    const local = [
      makeChatMessage({ id: "m1", content: "First" }),
      makeChatMessage({ id: "m2", content: "Second" }),
      makeChatMessage({ id: "m3", content: "Third" }),
    ];
    const remote = [makeChatMessage({ id: "m2", content: "Second-updated" })];
    const result = appendOnlyMerge(local, remote, getChatMsgId);
    expect(result).toHaveLength(3);
    expect(result.find((r) => r.id === "m1")).toBeDefined();
    expect(result.find((r) => r.id === "m3")).toBeDefined();
    // Remote copy preferred for m2
    expect(result.find((r) => r.id === "m2")!.content).toBe("Second-updated");
  });

  it("empty local + remote messages yields remote messages", () => {
    const local: ChatMessageItem[] = [];
    const remote = [
      makeChatMessage({ id: "m1", content: "From server" }),
      makeChatMessage({ id: "m2", role: "assistant", content: "Response" }),
    ];
    const result = appendOnlyMerge(local, remote, getChatMsgId);
    expect(result).toHaveLength(2);
  });

  it("empty remote does not remove local messages", () => {
    const local = [makeChatMessage({ id: "m1" }), makeChatMessage({ id: "m2" })];
    const remote: ChatMessageItem[] = [];
    const result = appendOnlyMerge(local, remote, getChatMsgId);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// lwwMerge — settings-shaped records
// ---------------------------------------------------------------------------

type SettingsItem = {
  theme: string;
  fontSize: number;
  updatedAt: number;
};

function makeSettings(overrides: Partial<SettingsItem>): SettingsItem {
  return {
    theme: "light",
    fontSize: 16,
    updatedAt: 100,
    ...overrides,
  };
}

describe("lwwMerge — settings", () => {
  it("remote newer settings win", () => {
    const local = makeSettings({ updatedAt: 100, theme: "light", fontSize: 16 });
    const remote = makeSettings({ updatedAt: 200, theme: "dark", fontSize: 18 });
    const result = lwwMerge(local, remote);
    expect(result).toBe(remote);
    expect(result.theme).toBe("dark");
    expect(result.fontSize).toBe(18);
  });

  it("local newer settings win", () => {
    const local = makeSettings({ updatedAt: 300, theme: "sepia", fontSize: 20 });
    const remote = makeSettings({ updatedAt: 200, theme: "dark", fontSize: 18 });
    const result = lwwMerge(local, remote);
    expect(result).toBe(local);
    expect(result.theme).toBe("sepia");
    expect(result.fontSize).toBe(20);
  });

  it("equal timestamps — remote wins (server authority)", () => {
    const local = makeSettings({ updatedAt: 100, theme: "light" });
    const remote = makeSettings({ updatedAt: 100, theme: "dark" });
    const result = lwwMerge(local, remote);
    expect(result).toBe(remote);
    expect(result.theme).toBe("dark");
  });
});
