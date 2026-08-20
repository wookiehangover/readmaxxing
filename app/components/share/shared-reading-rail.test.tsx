import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadingRailTabProvider } from "~/components/reading-shell/reading-rail-tab-context";
import { SharedReadingRail } from "./shared-reading-rail";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => (
    <article data-testid="assistant-markdown">{children}</article>
  ),
}));

vi.mock("~/components/tiptap-editor", () => ({
  TiptapEditor: ({ content, editable }: { content: string; editable?: boolean }) => (
    <article data-testid="read-only-markdown" data-editable={String(editable)}>
      {content}
    </article>
  ),
}));

vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: (props: React.ComponentProps<"div">) => <div {...props} />,
}));

vi.mock("~/components/ui/message-scroller", () => ({
  MessageScrollerProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
  MessageScroller: (props: React.ComponentProps<"div">) => <div {...props} />,
  MessageScrollerViewport: (props: React.ComponentProps<"div">) => <div {...props} />,
  MessageScrollerContent: (props: React.ComponentProps<"div">) => <div {...props} />,
  MessageScrollerItem: ({
    messageId: _messageId,
    ...props
  }: React.ComponentProps<"div"> & { messageId: string }) => <div {...props} />,
}));

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
let container: HTMLDivElement;
let root: Root;

function responseFor(input: RequestInfo | URL): Response {
  const url = String(input);
  if (url.endsWith("/notebook")) return Response.json({ markdown: "# Shared notes" });
  if (url.endsWith("/chats")) {
    return Response.json({
      sessions: [
        {
          id: "session-1",
          title: "Chapter questions",
          messages: [
            { role: "user", content: "Who is speaking?", createdAt: "2026-01-01" },
            { role: "assistant", content: "**The narrator.**", createdAt: "2026-01-02" },
          ],
        },
        {
          id: "session-older",
          title: "Earlier discussion",
          messages: [
            { role: "user", content: "This should not be shown", createdAt: "2025-12-01" },
          ],
        },
      ],
    });
  }
  return Response.json({
    artifact: {
      content: "## Shared outline",
      revisionId: "revision-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}

async function renderRail(included: boolean) {
  await act(async () => {
    root.render(
      <ReadingRailTabProvider>
        <SharedReadingRail shareId="share/1" bookTitle="Shared Book" included={included} />
      </ReadingRailTabProvider>,
    );
  });
}

async function selectTab(name: string) {
  const tab = Array.from(container.querySelectorAll("[role='tab']")).find(
    (candidate) => candidate.textContent === name,
  ) as HTMLButtonElement | undefined;
  await act(async () => tab?.click());
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (input) => responseFor(input));
  vi.stubGlobal("fetch", fetchMock);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SharedReadingRail", () => {
  it("renders read-only shared Notes, Discuss, and Outline tabs", async () => {
    await renderRail(true);

    expect(
      Array.from(container.querySelectorAll("[role='tab']"), (tab) => tab.textContent),
    ).toEqual(["Notes", "Discuss", "Outline"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/share/share%2F1/notebook", {
      signal: expect.any(AbortSignal),
    });
    expect(container.querySelector("[aria-label='Shared notes']")?.textContent).toContain(
      "# Shared notes",
    );

    await selectTab("Discuss");
    expect(fetchMock).toHaveBeenCalledWith("/api/share/share%2F1/chats", {
      signal: expect.any(AbortSignal),
    });
    expect(container.textContent).toContain("Chapter questions");
    expect(container.textContent).toContain("Who is speaking?");
    expect(container.querySelector("[data-testid='assistant-markdown']")?.textContent).toBe(
      "**The narrator.**",
    );
    expect(container.textContent).not.toContain("Earlier discussion");
    expect(container.textContent).not.toContain("This should not be shown");

    await selectTab("Outline");
    expect(fetchMock).toHaveBeenCalledWith("/api/share/share%2F1/artifacts", {
      signal: expect.any(AbortSignal),
    });
    expect(container.querySelector("[aria-label='Shared outline']")?.textContent).toContain(
      "## Shared outline",
    );
    expect(
      Array.from(container.querySelectorAll("[data-testid='read-only-markdown']")).every(
        (panel) => panel.getAttribute("data-editable") === "false",
      ),
    ).toBe(true);
    expect(container.querySelector("textarea, input, form")).toBeNull();
  });

  it("omits excluded Notes, defaults to Discuss, and still exposes the empty outline", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/artifacts")) return Response.json({ artifact: null });
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    await renderRail(false);
    expect(
      Array.from(container.querySelectorAll("[role='tab']"), (tab) => tab.textContent),
    ).toEqual(["Discuss", "Outline"]);
    expect(container.textContent).toContain(
      "Chat sessions were not included with this share link.",
    );
    expect(container.textContent).not.toContain("Notes not included");
    expect(fetchMock).not.toHaveBeenCalled();

    await selectTab("Outline");
    expect(container.textContent).toContain("No outline yet");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("omits Notes with empty markdown and opens the most recent discussion", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/notebook")) return Response.json({ markdown: "  \n " });
      return responseFor(input);
    });

    await renderRail(true);

    expect(
      Array.from(container.querySelectorAll("[role='tab']"), (tab) => tab.textContent),
    ).toEqual(["Discuss", "Outline"]);
    expect(container.textContent).toContain("Chapter questions");
    expect(container.textContent).not.toContain("No shared notes");
    expect(container.textContent).not.toContain("Earlier discussion");
  });

  it("keeps the existing empty Discuss state when there are no sessions", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/notebook")) return Response.json({ markdown: "" });
      if (String(input).endsWith("/chats")) return Response.json({ sessions: [] });
      return responseFor(input);
    });

    await renderRail(true);

    expect(container.textContent).toContain("No shared chats");
    expect(container.textContent).toContain("There are no chat sessions for this book yet.");
  });
});
