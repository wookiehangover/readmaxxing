import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READER_DWELL_MS, useReaderDwell, type ReadingDwellUnit } from "./use-reader-dwell";

const mocks = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    user: { id: "reader-test" } as { id: string } | null,
  },
  workspace: {
    activeClusterBookIdRef: { current: null as string | null },
    subscribeClusterChanges: (_listener: () => void) => () => {},
  },
}));

vi.mock("~/lib/context/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("~/lib/context/workspace-context", () => ({
  useOptionalWorkspace: () => mocks.workspace,
}));

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
let roots: Root[] = [];
let testNumber = 0;

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function render(unit: ReadingDwellUnit, bookId = `book-${testNumber}`) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);

  function Harness({ currentUnit }: { currentUnit: ReadingDwellUnit }) {
    useReaderDwell({ bookId, unit: currentUnit });
    return null;
  }

  const rerender = async (currentUnit: ReadingDwellUnit) => {
    await act(async () => root.render(<Harness currentUnit={currentUnit} />));
  };
  await rerender(unit);
  return { root, rerender };
}

async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

beforeEach(() => {
  testNumber += 1;
  vi.useFakeTimers();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async (_algorithm: string, input: ArrayBuffer) => {
        const source = new Uint8Array(input);
        const result = new Uint8Array(32);
        source.forEach((byte, index) => {
          result[index % result.length] = (result[index % result.length] + byte) % 256;
        });
        return result.buffer;
      },
    },
  });
  mocks.auth.isAuthenticated = true;
  mocks.auth.user = { id: `reader-${testNumber}` };
  mocks.workspace.activeClusterBookIdRef.current = null;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useReaderDwell", () => {
  it("posts once after ten visible seconds", async () => {
    await render({
      unitKind: "epub-spine",
      locator: "chapter-1.xhtml",
      text: "Visible chapter text with enough content",
    });

    await advance(READER_DWELL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(READER_DWELL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not count hidden time toward dwell", async () => {
    await render({
      unitKind: "pdf-page",
      locator: "page:2",
      text: "Visible PDF page text with enough content",
    });

    await advance(6_000);
    act(() => setVisibility("hidden"));
    await advance(READER_DWELL_MS);
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    await advance(3_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resets the timer when the unit changes", async () => {
    const { rerender } = await render({
      unitKind: "epub-spine",
      locator: "chapter-a.xhtml",
      text: "First chapter text with enough content",
    });
    await advance(9_000);

    await rerender({
      unitKind: "epub-spine",
      locator: "chapter-b.xhtml",
      text: "Second chapter text with enough content",
    });
    await advance(1_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await advance(9_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).locator).toBe("chapter-b.xhtml");
  });

  it("does not repost a cached fingerprint while the first request is slow", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    const unit: ReadingDwellUnit = {
      unitKind: "pdf-page",
      locator: "page:7",
      text: "A page with an intentionally slow ingest request",
    };
    const first = await render(unit);

    await advance(READER_DWELL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => first.root.unmount());
    roots = roots.filter((root) => root !== first.root);

    await render(unit);
    await advance(READER_DWELL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
