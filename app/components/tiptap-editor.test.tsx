import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TiptapEditor, type TiptapEditorHandle } from "~/components/tiptap-editor";

const PLACEHOLDER = "If you're not writing, you're not reading";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("TiptapEditor placeholder", () => {
  it("shows only for empty content without persisting the copy", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const editorRef = createRef<TiptapEditorHandle>();
    root = createRoot(container);

    await act(async () =>
      root?.render(<TiptapEditor ref={editorRef} compact placeholder={PLACEHOLDER} />),
    );

    const placeholder = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent === PLACEHOLDER,
    );
    expect(placeholder?.classList.contains("text-muted-foreground/35")).toBe(true);
    expect(placeholder?.classList.contains("text-muted-foreground")).toBe(false);
    expect(JSON.stringify(editorRef.current?.getContent())).not.toContain(PLACEHOLDER);

    act(() => editorRef.current?.setContent("Written note"));
    expect(container.textContent).not.toContain(PLACEHOLDER);

    act(() => editorRef.current?.setContent({ type: "doc", content: [] }));
    expect(container.textContent).toContain(PLACEHOLDER);
    expect(JSON.stringify(editorRef.current?.getContent())).not.toContain(PLACEHOLDER);
  });

  it("does not show for initially filled notes", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);

    await act(async () =>
      root?.render(<TiptapEditor content="Written note" compact placeholder={PLACEHOLDER} />),
    );

    expect(container.textContent).not.toContain(PLACEHOLDER);
    expect(container.textContent).toContain("Written note");
  });
});

describe("TiptapEditor rail heading styles", () => {
  it("keeps semantic headings while applying the quiet editorial scale", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);

    await act(async () =>
      root?.render(
        <TiptapEditor
          content={{
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H1" }] },
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H2" }] },
            ],
          }}
          compact
        />,
      ),
    );

    const prose = container.querySelector(".prose");
    expect(container.querySelector("h1")?.textContent).toBe("H1");
    expect(container.querySelector("h2")?.textContent).toBe("H2");
    expect(prose?.classList.contains("[&_h1]:text-[1.125em]")).toBe(true);
    expect(prose?.classList.contains("[&_h1]:font-medium")).toBe(true);
    expect(prose?.classList.contains("[&_h2]:text-[1em]")).toBe(true);
    expect(prose?.classList.contains("[&_h2]:font-medium")).toBe(true);
    expect(prose?.classList.contains("[&_h3]:text-[0.9375em]")).toBe(true);
    expect(prose?.classList.contains("[&_h4]:text-[0.875em]")).toBe(true);
    expect(prose?.classList.contains("[&_h5]:text-[0.8125em]")).toBe(true);
    expect(prose?.classList.contains("[&_h6]:text-[0.75em]")).toBe(true);
  });
});

describe("TiptapEditor read-only mode", () => {
  it("renders content without an editable document", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);

    await act(async () =>
      root?.render(<TiptapEditor content="Shared content" compact editable={false} />),
    );

    expect(container.textContent).toContain("Shared content");
    expect(container.querySelector(".tiptap")?.getAttribute("contenteditable")).toBe("false");
  });
});
