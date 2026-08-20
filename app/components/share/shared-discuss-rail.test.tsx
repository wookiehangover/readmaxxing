import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedDiscussRail } from "./shared-discuss-rail";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => (
    <article data-testid="assistant-markdown">{children}</article>
  ),
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

async function renderRail(included: boolean) {
  await act(async () => {
    root.render(<SharedDiscussRail shareId="share/1" included={included} />);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SharedDiscussRail", () => {
  it("renders shared sessions and assistant markdown when chats are enabled", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        sessions: [
          {
            id: "session-1",
            title: "Chapter questions",
            messages: [
              { role: "user", content: "Who is speaking?", createdAt: "2026-01-01" },
              { role: "assistant", content: "**The narrator.**", createdAt: "2026-01-02" },
            ],
          },
        ],
      }),
    );

    await renderRail(true);

    expect(fetchMock).toHaveBeenCalledWith("/api/share/share%2F1/chats", {
      signal: expect.any(AbortSignal),
    });
    expect(container.textContent).toContain("Chapter questions");
    expect(container.textContent).toContain("Who is speaking?");
    expect(container.querySelector("[data-testid='assistant-markdown']")?.textContent).toBe(
      "**The narrator.**",
    );
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(1);
    expect(container.querySelector("[role='tab']")?.textContent).toBe("Discuss");
    expect(container.textContent).not.toMatch(/Notes|Outline|Review/);
    expect(container.querySelector("textarea, input, form")).toBeNull();
  });

  it("does not fetch and explains when chats were not included", async () => {
    await renderRail(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Chat sessions were not included with this share link.",
    );
  });

  it("shows a loading state while shared chats are pending", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    await renderRail(true);

    expect(container.querySelector("[aria-label='Loading shared chats']")).not.toBeNull();
  });

  it("shows the API error when shared chats fail to load", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Shared chats unavailable" }), { status: 503 }),
    );

    await renderRail(true);

    expect(container.textContent).toContain("Could not load shared chats");
    expect(container.textContent).toContain("Shared chats unavailable");
  });
});
