import { useEditor, EditorContent, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import {
  HighlightReference,
  type HighlightReferenceAttrs,
} from "~/lib/tiptap-highlight-node";
import type { JSONContent } from "@tiptap/react";

interface TiptapEditorProps {
  content?: JSONContent;
  onUpdate?: (content: JSONContent) => void;
  onNavigateToHighlight?: (cfi: string) => void;
}

function HighlightReferenceView({ node }: ReactNodeViewProps) {
  const { text, cfiRange } = node.attrs as HighlightReferenceAttrs;

  const handleClick = () => {
    // Dispatch a custom event that the panel can listen for
    window.dispatchEvent(
      new CustomEvent("navigate-to-highlight", { detail: { cfi: cfiRange } }),
    );
  };

  return (
    <NodeViewWrapper>
      <blockquote
        onClick={handleClick}
        className="my-2 cursor-pointer rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm italic text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-950/80"
        title="Click to navigate to this highlight"
      >
        "{text}"
      </blockquote>
    </NodeViewWrapper>
  );
}

export function TiptapEditor({
  content,
  onUpdate,
  onNavigateToHighlight,
}: TiptapEditorProps) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const editor = useEditor({
    extensions: [
      StarterKit,
      HighlightReference.configure({
        component: HighlightReferenceView,
      }),
    ],
    content: content || {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    onUpdate: ({ editor }) => {
      onUpdateRef.current?.(editor.getJSON());
    },
    immediatelyRender: true,
  });

  // Listen for highlight navigation events
  useEffect(() => {
    if (!onNavigateToHighlight) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onNavigateToHighlight(detail.cfi);
    };
    window.addEventListener("navigate-to-highlight", handler);
    return () => window.removeEventListener("navigate-to-highlight", handler);
  }, [onNavigateToHighlight]);

  // Listen for insert-highlight-reference events from the panel
  useEffect(() => {
    if (!editor) return;
    const handler = (e: Event) => {
      const attrs = (e as CustomEvent).detail as HighlightReferenceAttrs;
      editor.chain().focus().insertHighlightReference(attrs).run();
    };
    window.addEventListener("insert-highlight-reference", handler);
    return () =>
      window.removeEventListener("insert-highlight-reference", handler);
  }, [editor]);

  // Listen for append-highlight-reference events (auto-insert on new highlight)
  useEffect(() => {
    if (!editor) return;
    const handler = (e: Event) => {
      const attrs = (e as CustomEvent).detail as HighlightReferenceAttrs;
      const endPos = editor.state.doc.content.size;
      editor
        .chain()
        .insertContentAt(endPos, {
          type: "highlightReference",
          attrs,
        })
        .run();
    };
    window.addEventListener("append-highlight-reference", handler);
    return () =>
      window.removeEventListener("append-highlight-reference", handler);
  }, [editor]);

  return (
    <div className="tiptap-editor">
      <EditorContent
        editor={editor}
        className="prose prose-sm dark:prose-invert max-w-none px-4 py-3 focus:outline-none [&_.tiptap]:min-h-[200px] [&_.tiptap]:outline-none"
      />
    </div>
  );
}

export type { TiptapEditorProps };

