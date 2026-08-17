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
    expect(placeholder?.classList.contains("text-muted-foreground")).toBe(true);
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
