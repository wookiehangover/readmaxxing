import { useEditor, EditorContent, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Navigation, Trash2 } from "lucide-react";
import {
  HighlightReference,
  type HighlightReferenceAttrs,
} from "~/lib/editor/tiptap-highlight-node";

export interface TiptapEditorHandle {
  appendHighlightReference: (attrs: HighlightReferenceAttrs) => void;
}

interface TiptapEditorProps {
  content?: JSONContent;
  onUpdate?: (content: JSONContent) => void;
  onNavigateToHighlight?: (cfi: string) => void | Promise<void>;
  onDeleteHighlight?: (highlightId: string, cfiRange: string) => void;
}

function HighlightReferenceView({ node, editor, deleteNode }: ReactNodeViewProps) {
  const { text, cfiRange, highlightId } = node.attrs as HighlightReferenceAttrs;

  const handleNavigate = useCallback(() => {
    editor.view.dom.dispatchEvent(
      new CustomEvent("highlight-navigate", {
        detail: { cfi: cfiRange },
        bubbles: true,
      }),
    );
  }, [cfiRange, editor]);

  const handleDelete = useCallback(() => {
    editor.view.dom.dispatchEvent(
      new CustomEvent("highlight-delete", {
        detail: { highlightId, cfiRange },
        bubbles: true,
      }),
    );
    deleteNode();
  }, [highlightId, cfiRange, editor, deleteNode]);

  return (
    <NodeViewWrapper>
      <blockquote
        onClick={handleNavigate}
        className="group/hl relative my-2 cursor-pointer rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 pr-16 text-sm italic text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-950/80"
        title="Click to navigate to this highlight"
      >
        "{text}"
        <span className="absolute top-1/2 right-2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity group-hover/hl:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNavigate();
            }}
            className="rounded p-1 text-amber-700 hover:bg-amber-200 dark:text-amber-300 dark:hover:bg-amber-800"
            title="Navigate to highlight"
          >
            <Navigation className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            className="rounded p-1 text-amber-700 hover:bg-red-100 hover:text-red-600 dark:text-amber-300 dark:hover:bg-red-900 dark:hover:text-red-400"
            title="Delete highlight"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </blockquote>
    </NodeViewWrapper>
  );
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(function TiptapEditor(
  { content, onUpdate, onNavigateToHighlight, onDeleteHighlight },
  ref,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: false,
      }),
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

  // Listen for custom DOM events dispatched by HighlightReferenceView
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const handleNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onNavigateToHighlight?.(detail.cfi);
    };

    const handleDelete = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onDeleteHighlight?.(detail.highlightId, detail.cfiRange);
    };

    dom.addEventListener("highlight-navigate", handleNavigate);
    dom.addEventListener("highlight-delete", handleDelete);
    return () => {
      dom.removeEventListener("highlight-navigate", handleNavigate);
      dom.removeEventListener("highlight-delete", handleDelete);
    };
  }, [editor, onNavigateToHighlight, onDeleteHighlight]);

  // Expose imperative handle for appending highlight references
  useImperativeHandle(
    ref,
    () => ({
      appendHighlightReference(attrs: HighlightReferenceAttrs) {
        if (!editor) return;
        const nodes: JSONContent[] = [{ type: "highlightReference", attrs }, { type: "paragraph" }];
        const endPos = editor.state.doc.content.size;
        editor.chain().focus().insertContentAt(endPos, nodes).run();
      },
    }),
    [editor],
  );

  return (
    <div className="tiptap-editor">
      <EditorContent
        editor={editor}
        className="prose prose-sm dark:prose-invert max-w-none px-4 py-3 focus:outline-none [&_.tiptap]:min-h-[200px] [&_.tiptap]:outline-none [&_.tiptap_li]:my-0.5"
      />
    </div>
  );
});
